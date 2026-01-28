// =====================================
// BOT VALÉRIA DARÉ ADVOCACIA - VERSÃO OTIMIZADA
// =====================================
require('dotenv').config(); 
const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");
const express = require("express");
const qrcodeImage = require("qrcode");
const fs = require('fs');

// =====================================
// CONFIGURAÇÕES
// =====================================
const PORT = process.env.PORT || 3000;
const API_URL = process.env.WEBHOOK_URL || "https://webhook.site/cc903f72-48a6-47a1-bb06-c89f5c6eefe2";

const WORK_HOUR_START = 9;
const WORK_HOUR_END = 18;
const SESSION_TIMEOUT_MS = 60 * 60 * 1000; 

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
// ESTADO E SERVIDOR
// =====================================
const app = express();
let currentQRCode = null;
let isConnected = false;
const userSessions = new Map();

// =====================================
// FUNÇÕES AUXILIARES
// =====================================
const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

function isBusinessHours() {
    const agora = new Date();
    const diaSemana = agora.getDay(); // 0 = Domingo, 6 = Sábado
    const hora = agora.getHours();
    return (diaSemana >= 1 && diaSemana <= 5) && (hora >= WORK_HOUR_START && hora < WORK_HOUR_END);
}

setInterval(() => {
    const now = Date.now();
    userSessions.forEach((session, key) => {
        if (now - session.lastInteraction > SESSION_TIMEOUT_MS) {
            userSessions.delete(key);
            log(`🧹 Sessão limpa (timeout): ${key}`);
        }
    });
}, 60000); 

async function enviarDadosParaAPI(dados) {
    if (API_URL.includes("seu-link")) return;
    try {
        log("📤 Enviando dados para Webhook...");
        await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados)
        });
    } catch (error) {
        console.error("❌ Falha na conexão com a API:", error.message);
    }
}

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// =====================================
// CLIENTE WHATSAPP
// =====================================

// Tenta encontrar o Chrome no Windows (MANTIDO PARA EVITAR ERROS DE CONTEXTO)
const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Users\\' + (process.env.USERNAME || 'Administrator') + '\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
];

const executablePath = chromePaths.find(path => fs.existsSync(path));

if (executablePath) {
    log(`🖥️ Chrome encontrado em: ${executablePath}`);
} else {
    log(`⚠️ Chrome não encontrado. Usando Chromium do Puppeteer.`);
}

const client = new Client({
    authStrategy: new LocalAuth({ clientId: "valeria_bot" }),
    // Configurações de estabilidade
    authTimeoutMs: 60000, 
    puppeteer: {
        headless: true, // O navegador vai abrir para você ver
        executablePath: executablePath, // Usa o seu Chrome para não travar
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--disable-gpu",
            "--disable-extensions",
            "--disable-software-rasterizer"
        ],
    },
});

client.on("qr", (qr) => {
    currentQRCode = qr;
    isConnected = false;
    log("📲 NOVO QR CODE: Acesse http://localhost:" + PORT);
    qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
    log("✅ Bot Valéria Daré Conectado!");
    currentQRCode = null;
    isConnected = true;
});

client.on("disconnected", (reason) => {
    log(`⚠️ Cliente desconectado! Motivo: ${reason}`);
    isConnected = false;
    setTimeout(() => {
        log("🔄 Tentando reconectar automaticamente...");
        client.initialize().catch(err => log(`Erro ao tentar reconectar: ${err.message}`));
    }, 5000);
});

// =====================================
// LÓGICA DE MENSAGENS
// =====================================
client.on("message", async (msg) => {
    try {
        if (!msg.from || msg.from.endsWith("@g.us") || msg.isStatus) return;
        if (msg.type === 'sticker') return;

        const chat = await msg.getChat();
        const texto = msg.body.trim();
        const contactId = msg.from;
        const lowerText = texto.toLowerCase();

        let session = userSessions.get(contactId) || { step: 'IDLE', lastInteraction: Date.now() };
        session.lastInteraction = Date.now();
        userSessions.set(contactId, session);

        if (['cancelar', 'sair', 'reset', 'inicio', 'encerrar'].includes(lowerText)) {
            userSessions.delete(contactId);
            await client.sendMessage(contactId, "🔄 Atendimento reiniciado. Envie um 'Oi' quando precisar.");
            return;
        }

        if (session.step === 'COMPLETED') return;

        const reply = async (text) => {
            await chat.sendStateTyping();
            const typingTime = Math.min(4000, Math.max(1000, text.length * 40));
            await delay(typingTime); 
            await client.sendMessage(contactId, text);
            await chat.clearState();
        };

        // PASSO 1: INÍCIO
        if (session.step === 'IDLE') {
            const saudacoesRegex = /^(oi|oi!|ooi|opa|dia|tarde|noite|Boa tarde!|bom|boa|dra|tudo bem|tudo|bem|Hi|olá|ola|bom dia!|bom dia|boa tarde|boa noite|bomdia|boanoite|boatarde|tarde!|boa tarde!|boa noite!|oii|olaa)$/i;
            if (!saudacoesRegex.test(texto)) return;

            session.step = 'WAITING_FOR_INFO';
            userSessions.set(contactId, session);
            
            await reply("Olá!");
            await reply("Você está entrando em contato com o Escritório Valéria Daré Advocacia.");
            await reply("Para iniciarmos, por favor, me informe seu nome e sobrenome.");
            return;
        }

        // PASSO 2: RECEBE NOME
        if (session.step === 'WAITING_FOR_INFO') {
            const infoCliente = texto;
            const primeiroPalavra = infoCliente.split(/[\s,]+/)[0];
            let nomeFormatado = primeiroPalavra.charAt(0).toUpperCase() + primeiroPalavra.slice(1).toLowerCase();

            const palavrasIgnoradas = [
                'oi', 'olá', 'ola', 'bom', 'boa', 'gostaria', 'queria', 'preciso', 'estou', 
                'sou', 'meu', 'não', 'nao', 'quero', 'assunto', 'sobre', 'tenho', 'necessito', 'favor'
            ];
            
            let saudacaoPersonalizada = "";
            let nomeParaSalvar = "Cliente"; 

            if (!palavrasIgnoradas.includes(nomeFormatado.toLowerCase()) && nomeFormatado.length > 2) {
                saudacaoPersonalizada = `, *${nomeFormatado}*`;
                nomeParaSalvar = nomeFormatado;
            }

            // ATUALIZADO CONFORME PEDIDO
            let menu = `Certo${saudacaoPersonalizada}! No que podemos te ajudar?\n\n` +
                        `Por gentileza, digite o NÚMERO da opção desejada:\n\n`;
            
            Object.keys(DEPARTMENTS).forEach(key => {
                menu += `*${key}* - ${DEPARTMENTS[key].name}\n`;
            });
            menu += `*0* - Outros Assuntos`;

            session.step = 'WAITING_FOR_SELECTION';
            session.clientInfo = infoCliente;
            session.clientName = nomeParaSalvar; 
            userSessions.set(contactId, session);

            await reply(menu);
            return;
        }

        // PASSO 3: SELEÇÃO
        if (session.step === 'WAITING_FOR_SELECTION') {
            const numeroOpcao = texto.replace(/\D/g, ''); 
            const opcao = parseInt(numeroOpcao);
            let dept = null;

            if (numeroOpcao === '0' || texto === '0') {
                dept = GENERAL_ATTENDANCE;
            } else if (DEPARTMENTS[opcao]) {
                dept = DEPARTMENTS[opcao];
            } else {
                // ATUALIZADO CONFORME PEDIDO
                await reply("Me desculpe, não entendi. Poderia por gentileza escolher o número da opção desejada?");
                return;
            }

            session.selectedDept = dept;
            session.step = 'WAITING_FOR_REASON';
            userSessions.set(contactId, session);

            const nome = session.clientName || "Cliente";
            // ATUALIZADO CONFORME PEDIDO
            await reply(`${nome}, se você pudesse resumir em poucas palavras a escolha desse assunto, qual seria?`);
            return;
        }

        // PASSO 4: FINALIZAÇÃO
        if (session.step === 'WAITING_FOR_REASON') {
            const motivo = texto; 
            const dept = session.selectedDept;

            // ATUALIZADO CONFORME PEDIDO
            let msgFinal = `Perfeito! Já estamos te transferindo para um de nossos Doutores do *${dept.name}*.\n\n` +
                           `Aguarde um momento, por favor.`;

            if (!isBusinessHours()) {
                msgFinal += `\n\n🕒 *Atenção:* Estamos fora do horário comercial (09h às 18h). Seu atendimento será priorizado no próximo dia útil.`;
            }

            await reply(msgFinal);

            const linkWhats = `https://wa.me/${contactId.replace('@c.us', '')}`;
            const infoCompleta = `Info Inicial: ${session.clientInfo}\n📝 *Resumo do Cliente:* ${motivo}`;

            const relatorio = `🚨 *NOVO LEAD: ${dept.name}*\n\n` +
                              `👤 *Cliente:* ${session.clientName}\n` +
                              `💬 *Detalhes:* ${infoCompleta}\n` +
                              `📞 *Whatsapp:* ${linkWhats}\n` +
                              `📅 *Data:* ${new Date().toLocaleString('pt-BR')}\n\n` +
                              `💡 *Ação:* Entrar em contato.`;

            log(`Encaminhando lead para: ${dept.responsavel_nome}`);

            if (dept.responsavel_id) {
                setTimeout(async () => {
                    try {
                        await client.sendMessage(dept.responsavel_id, relatorio);
                    } catch (e) {
                        log(`Erro ao notificar advogado: ${e.message}`);
                    }
                }, 2000);
            }

            enviarDadosParaAPI({
                telefone: contactId.replace('@c.us', ''),
                nome: session.clientName,
                info: infoCompleta,
                setor: dept.name,
                timestamp: new Date().toISOString()
            });

            session.step = 'COMPLETED';
            userSessions.set(contactId, session);
        }

    } catch (error) {
        log(`❌ Erro Crítico: ${error}`);
    }
});

// =====================================
// SERVIDOR WEB
// =====================================
app.get('/', async (req, res) => {
    const refreshScript = `<script>setTimeout(function(){location.reload()}, 10000);</script>`;
    if (isConnected) {
        res.send(`<h1 style="color:green;text-align:center">✅ WhatsApp Conectado!</h1>`);
    } else if (currentQRCode) {
        try {
            const url = await qrcodeImage.toDataURL(currentQRCode);
            res.send(`<div style="text-align:center"><h1>📲 Escaneie o QR Code</h1><img src="${url}" width="300"/><p>A página atualiza sozinha.</p>${refreshScript}</div>`);
        } catch (err) { res.send('Erro ao gerar imagem.'); }
    } else {
        res.send(`<div style="text-align:center"><h1>🔄 Inicializando...</h1><p>Aguarde...</p>${refreshScript}</div>`);
    }
});

app.listen(PORT, () => {
    log(`🌐 Servidor Web rodando em: http://localhost:${PORT}`);
});

process.on('SIGINT', async () => {
    log('🔴 Encerrando bot...');
    try { await client.destroy(); } catch (e) {}
    process.exit(0);
});


client.initialize().catch(err => log(`❌ Erro fatal: ${err.message}`));
