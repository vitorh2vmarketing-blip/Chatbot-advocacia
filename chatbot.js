// =====================================
// BOT VALÉRIA DARÉ ADVOCACIA - VERSÃO FINAL (FACTORY RESET + VERSION LOCK)
// =====================================
require('dotenv').config(); 
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");
const express = require("express");
const qrcodeImage = require("qrcode");
const fs = require('fs');
const path = require('path');

// =====================================
// CONFIGURAÇÕES
// =====================================
const PORT = process.env.PORT || 3000;
const API_URL = process.env.WEBHOOK_URL || "https://webhook.site/cc903f72-48a6-47a1-bb06-c89f5c6eefe2";

const WORK_HOUR_START = 9;
const WORK_HOUR_END = 18;
const SESSION_TIMEOUT_MS = 60 * 60 * 1000; 

const BOT_START_TIMESTAMP = Math.floor(Date.now() / 1000);

// =====================================
// LIMPEZA NUCLEAR (PARA SAIR DO LOOP)
// =====================================
const SESSION_DIR_NAME = '.wwebjs_auth';
const SESSION_PATH = path.join(__dirname, SESSION_DIR_NAME);

// Sempre que o bot iniciar, vamos verificar se a sessão está travada
console.log("🧹 Verificando integridade da sessão...");
try {
    // Se existir, apagamos para forçar uma conexão limpa (Factory Reset)
    // Isso é necessário porque seu bot entrou em loop de autenticação
    if (fs.existsSync(SESSION_PATH)) {
        console.log("🔥 Sessão encontrada. Apagando para corrigir o loop...");
        fs.rmSync(SESSION_PATH, { recursive: true, force: true });
        console.log("✅ Sessão apagada. Um NOVO QR Code será gerado.");
    }
} catch (e) {
    console.error("⚠️ Erro ao limpar sessão:", e.message);
}

// =====================================
// DEPARTAMENTOS
// =====================================
const DEPARTMENTS = {
    1: { 
        name: "Direito Trabalhista", 
        responsavel_nome: "Dra. Valéria Daré (Trabalhista)", 
        responsavel_id: "5511913431522@c.us" 
    },
    2: { 
        name: "Direito Previdenciário", 
        responsavel_nome: "Dra. Valéria Daré (Previdenciário)", 
        responsavel_id: "5511913431522@c.us" 
    }
};

const GENERAL_ATTENDANCE = {
    name: "Atendimento Geral",
    responsavel_nome: "Valkiria Dragone",
    responsavel_id: "35999672058@c.us"
};

// =====================================
// ESTADO
// =====================================
const app = express();
let currentQRCode = null;
let isConnected = false;
let isReady = false; 
const userSessions = new Map();

// =====================================
// CLIENTE WHATSAPP
// =====================================

const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

const client = new Client({
    authStrategy: new LocalAuth({ 
        clientId: "valeria_bot",
        dataPath: SESSION_PATH // Força o caminho limpo
    }),
    // TRAVA DE VERSÃO: Usa uma versão conhecida por ser estável com contas pesadas
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
    authTimeoutMs: 120000, 
    puppeteer: {
        headless: true,
        executablePath: executablePath,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--disable-gpu",
            "--disable-extensions"
        ],
    },
});

// --- EVENTOS ---

client.on('loading_screen', (percent, message) => {
    console.log(`⏳ Carregando: ${percent}% - ${message}`);
    isReady = false;
});

// Variável para evitar logs repetidos de autenticação
let authLogShown = false;

client.on('authenticated', () => {
    if (!authLogShown) {
        console.log('🔐 Autenticado! Baixando conversas (isso pode demorar)...');
        authLogShown = true;
    }
});

client.on('auth_failure', msg => {
    console.error(`❌ Falha na autenticação: ${msg}`);
    process.exit(1); // Reinicia para tentar de novo
});

client.on("qr", (qr) => {
    currentQRCode = qr;
    isConnected = false;
    isReady = false;
    console.log("📲 NOVO QR CODE GERADO. Acesse o link para escanear.");
    qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
    console.log("✅✅✅ BOT PRONTO! WhatsApp conectado e operante.");
    currentQRCode = null;
    isConnected = true;
    isReady = true; 
});

client.on("disconnected", async (reason) => {
    console.log(`⚠️ Desconectado: ${reason}`);
    isConnected = false;
    isReady = false;
    try { await client.destroy(); } catch(e) {}
    process.exit(1); // Reinicia o container para limpar memória RAM
});

// =====================================
// LÓGICA DE MENSAGENS
// =====================================
client.on("message", async (msg) => {
    try {
        if (!isReady) return;
        if (msg.timestamp < BOT_START_TIMESTAMP) return;
        
        if (!msg.from || msg.from.includes("status") || msg.from.includes("g.us")) return;
        if (msg.type === 'sticker') return;
        if (client.info && client.info.wid && msg.from === client.info.wid._serialized) return;

        console.log(`📩 Msg de ${msg.from}: "${msg.body.substring(0, 30)}..."`);

        const chat = await msg.getChat();
        const texto = msg.body.trim();
        const contactId = msg.from;
        const lowerText = texto.toLowerCase();

        let session = userSessions.get(contactId) || { step: 'IDLE', lastInteraction: Date.now() };
        session.lastInteraction = Date.now();
        userSessions.set(contactId, session);

        // Reset
        if (['cancelar', 'sair', 'reset', 'inicio'].includes(lowerText)) {
            userSessions.delete(contactId);
            await client.sendMessage(contactId, "🔄 Reiniciado. Envie 'Oi'.");
            return;
        }

        const reply = async (text) => {
            await chat.sendStateTyping();
            await delay(1500); 
            await client.sendMessage(contactId, text);
            await chat.clearState();
        };

        // 1. SAUDAÇÃO
        if (session.step === 'IDLE') {
            const regex = /(oi|olá|ola|bom dia|boa tarde|boa noite|tarde|dia|noite|opa|tudo bem|bot|ajuda)/i;
            if (regex.test(texto)) {
                session.step = 'WAITING_FOR_INFO';
                userSessions.set(contactId, session);
                await reply("Olá! Você está entrando em contato com o Escritório Valéria Daré Advocacia.\nPara iniciar, por favor, informe seu NOME e SOBRENOME.");
            }
            return;
        }

        // 2. NOME
        if (session.step === 'WAITING_FOR_INFO') {
            const nome = texto.split(" ")[0];
            let menu = `Certo, ${nome}! Selecione a área:\n\n`;
            Object.keys(DEPARTMENTS).forEach(k => menu += `*${k}* - ${DEPARTMENTS[k].name}\n`);
            menu += `*0* - Outros`;

            session.step = 'WAITING_FOR_SELECTION';
            session.clientInfo = texto;
            session.clientName = nome;
            userSessions.set(contactId, session);
            await reply(menu);
            return;
        }

        // 3. SELEÇÃO
        if (session.step === 'WAITING_FOR_SELECTION') {
            const op = texto.replace(/\D/g, ''); 
            let dept = null;

            if (op === '0') dept = GENERAL_ATTENDANCE;
            else if (DEPARTMENTS[op]) dept = DEPARTMENTS[op];
            else {
                await reply("Opção inválida. Digite apenas o número.");
                return;
            }

            session.selectedDept = dept;
            session.step = 'WAITING_FOR_REASON';
            userSessions.set(contactId, session);
            await reply(`Entendido. Resuma o assunto em poucas palavras:`);
            return;
        }

        // 4. FINALIZAÇÃO
        if (session.step === 'WAITING_FOR_REASON') {
            const motivo = texto; 
            const dept = session.selectedDept;

            let msgFinal = `Perfeito! Transferindo para *${dept.name}*. Aguarde um momento.`;
            if (!isBusinessHours()) msgFinal += `\n\n🕒 Estamos fora do horário comercial.`;

            await reply(msgFinal);

            // Notifica Advogado
            if (dept.responsavel_id) {
                const link = `https://wa.me/${contactId.replace('@c.us', '')}`;
                const relatorio = `🚨 *LEAD: ${dept.name}*\n👤 ${session.clientInfo}\n📝 ${motivo}\n📞 ${link}`;
                setTimeout(() => client.sendMessage(dept.responsavel_id, relatorio).catch(console.error), 2000);
            }

            // Webhook
            enviarDadosParaAPI({
                telefone: contactId.replace('@c.us', ''),
                nome: session.clientName,
                info: motivo,
                setor: dept.name,
                timestamp: new Date().toISOString()
            });

            session.step = 'COMPLETED';
            userSessions.set(contactId, session);
        }

    } catch (error) {
        console.error("Erro msg:", error.message);
    }
});

// =====================================
// SERVIDOR WEB
// =====================================
app.get('/', async (req, res) => {
    const refresh = `<script>setTimeout(()=>location.reload(),5000)</script>`;
    if (isConnected) {
        res.send(`<h1 style="color:green;text-align:center">✅ Conectado!</h1>`);
    } else if (currentQRCode) {
        try {
            const url = await qrcodeImage.toDataURL(currentQRCode);
            res.send(`<div style="text-align:center"><h1>Escaneie Agora</h1><img src="${url}" width="300"/>${refresh}</div>`);
        } catch (e) { res.send('Erro img'); }
    } else {
        res.send(`<div style="text-align:center"><h1>Iniciando...</h1>${refresh}</div>`);
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Servidor rodando na porta ${PORT}`);
});

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// Loop de segurança: Se não ficar pronto em 60s após autenticar, mata o processo.
setTimeout(() => {
    if (!isReady && isConnected) {
        console.log("⏰ Timeout de inicialização. Reiniciando para destravar...");
        process.exit(1);
    }
}, 120000); // 2 minutos de tolerância

client.initialize().catch(err => console.log(`❌ Erro init: ${err.message}`));
