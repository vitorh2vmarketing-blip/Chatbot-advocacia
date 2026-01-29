// =====================================
// BOT VALÉRIA DARÉ ADVOCACIA - VERSÃO RAILWAY FINAL STABLE
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
let isReady = false; // Nova variável para controlar se já pode responder
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

// Lógica Híbrida: Tenta achar no Windows OU usa a variável de ambiente do Docker/Railway (Linux)
const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Users\\' + (process.env.USERNAME || 'Administrator') + '\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'
];

const executablePath = chromePaths.find(p => fs.existsSync(p)) || process.env.PUPPETEER_EXECUTABLE_PATH;

if (executablePath) {
    log(`🖥️ Navegador definido em: ${executablePath}`);
} else {
    log(`⚠️ Navegador não encontrado. O Puppeteer tentará usar a versão padrão.`);
}

const client = new Client({
    authStrategy: new LocalAuth({ 
        clientId: "valeria_bot",
        dataPath: path.resolve(__dirname, '.wwebjs_auth') 
    }),
    authTimeoutMs: 120000, 
    puppeteer: {
        headless: true, // Obrigatório na Railway
        executablePath: executablePath, 
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--single-process", 
            "--disable-gpu"
        ],
    },
});

// --- LOGS DE DIAGNÓSTICO ---

client.on('loading_screen', (percent, message) => {
    log(`⏳ Sincronizando WhatsApp: ${percent}% - ${message}`);
    isReady = false;
});

client.on('authenticated', () => {
    log('🔐 Autenticado com sucesso! Aguardando carregamento final...');
});

client.on('auth_failure', msg => {
    log(`❌ Falha na autenticação: ${msg}`);
});

client.on("qr", (qr) => {
    currentQRCode = qr;
    isConnected = false;
    isReady = false;
    log("📲 NOVO QR CODE: Acesse http://localhost:" + PORT);
    qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
    log("✅ Bot Valéria Daré Conectado e PRONTO PARA RESPONDER!");
    currentQRCode = null;
    isConnected = true;
    isReady = true; // SINAL VERDE: Agora pode responder
    
    // Heartbeat
    setInterval(() => {
        log("💓 Bot ativo e aguardando mensagens...");
    }, 60000);
});

client.on("disconnected", (reason) => {
    log(`⚠️ Cliente desconectado! Motivo: ${reason}`);
    isConnected = false;
    isReady = false;
    
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
        // --- PROTEÇÃO DE INICIALIZAÇÃO ---
        if (!isReady) {
            console.log(`⏳ Recebi mensagem de ${msg.from}, mas ainda estou carregando (Sync). Ignorando por segurança.`);
            return;
        }

        // --- ÁREA DE DEBUG ---
        console.log(`📩 Debug: Mensagem de ${msg.from}: "${msg.body}"`);

        // Filtros de segurança
        if (!msg.from) return;
        if (msg.from.includes("status")) return;
        if (msg.from.includes("g.us")) return;

        // FIX: Verifica se client.info existe antes de comparar (evita crash na inicialização)
        if (client.info && client.info.wid && msg.from === client.info.wid._serialized) {
             console.log(`🔇 Ignorado: Mensagem enviada por mim mesmo.`);
             return;
        }
        
        if (msg.type === 'sticker') return;

        const chat = await msg.getChat();
        const texto = msg.body.trim();
        const contactId = msg.from;
        const lowerText = texto.toLowerCase();

        let session = userSessions.get(contactId) || { step: 'IDLE', lastInteraction: Date.now() };
        session.lastInteraction = Date.now();
        userSessions.set(contactId, session);

        // Reset global
        if (['cancelar', 'sair', 'reset', 'inicio', 'encerrar'].includes(lowerText)) {
            userSessions.delete(contactId);
            await client.sendMessage(contactId, "🔄 Atendimento reiniciado. Envie um 'Oi' quando precisar.");
            console.log(`🔄 Sessão resetada para ${contactId}`);
            return;
        }

        if (session.step === 'COMPLETED') {
            console.log(`🔇 Ignorado: Usuário ${contactId} já completou o atendimento.`);
            return;
        }

        const reply = async (text) => {
            await chat.sendStateTyping();
            const typingTime = Math.min(4000, Math.max(1000, text.length * 40));
            await delay(typingTime); 
            await client.sendMessage(contactId, text);
            await chat.clearState();
            console.log(`✅ Resposta enviada para ${contactId}: "${text.substring(0, 20)}..."`);
        };

        // PASSO 1: INÍCIO
        if (session.step === 'IDLE') {
            const saudacoesRegex = /(oi|olá|ola|bom dia|boa tarde|boa noite|tarde|dia|noite|opa|tudo bem|bot|ajuda)/i;
            
            if (!saudacoesRegex.test(texto)) {
                console.log(`🔇 Ignorando mensagem fora do padrão: "${texto}"`);
                return;
            }

            console.log(`✅ Saudação detectada! Iniciando atendimento para ${contactId}`);
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

            const palavrasIgnoradas = ['oi', 'olá', 'ola', 'bom', 'boa', 'gostaria', 'queria', 'preciso', 'estou', 'sou', 'meu', 'não', 'nao', 'quero', 'assunto', 'sobre', 'tenho', 'necessito', 'favor'];
            
            let saudacaoPersonalizada = "";
            let nomeParaSalvar = "Cliente"; 

            if (!palavrasIgnoradas.includes(nomeFormatado.toLowerCase()) && nomeFormatado.length > 2) {
                saudacaoPersonalizada = `, *${nomeFormatado}*`;
                nomeParaSalvar = nomeFormatado;
            }

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
                await reply("Me desculpe, não entendi. Poderia por gentileza escolher o número da opção desejada?");
                return;
            }

            session.selectedDept = dept;
            session.step = 'WAITING_FOR_REASON';
            userSessions.set(contactId, session);

            const nome = session.clientName || "Cliente";
            await reply(`${nome}, se você pudesse resumir em poucas palavras a escolha desse assunto, qual seria?`);
            return;
        }

        // PASSO 4: FINALIZAÇÃO
        if (session.step === 'WAITING_FOR_REASON') {
            const motivo = texto; 
            const dept = session.selectedDept;

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

app.listen(PORT, '0.0.0.0', () => {
    log(`🌐 Servidor Web rodando em: http://0.0.0.0:${PORT}`);
});

process.on('SIGINT', async () => {
    log('🔴 Encerrando bot...');
    try { await client.destroy(); } catch (e) {}
    process.exit(0);
});

client.initialize().catch(err => log(`❌ Erro fatal: ${err.message}`));
