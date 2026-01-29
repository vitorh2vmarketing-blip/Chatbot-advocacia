// =====================================
// BOT VALÉRIA DARÉ ADVOCACIA - VERSÃO FINAL (RAILWAY 2GB + LÓGICA HUMANIZADA)
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
const SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 1 hora de sessão

// Marca o horário de início para ignorar mensagens antigas
const BOT_START_TIMESTAMP = Math.floor(Date.now() / 1000);

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
let isReady = false; 
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

// Limpeza automática de sessões inativas
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

// Tenta pegar caminho do Chrome automaticamente (Docker ou Local)
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || undefined;

const client = new Client({
    authStrategy: new LocalAuth({ 
        clientId: "valeria_bot",
        // Caminho explícito para garantir persistência no Docker/Railway
        dataPath: "/app/.wwebjs_auth"
    }),
    // Configurações para estabilidade em nuvem
    authTimeoutMs: 120000, 
    puppeteer: {
        headless: true, // Obrigatório na Railway
        executablePath: executablePath,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage", // Crítico para memória
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--single-process", 
            "--disable-gpu"
        ],
    },
});

// --- EVENTOS ---

client.on('loading_screen', (percent, message) => {
    log(`⏳ Carregando WhatsApp: ${percent}% - ${message}`);
    isReady = false;
});

client.on('authenticated', () => {
    log('🔐 Autenticado! Carregando conversas...');
});

client.on('auth_failure', msg => {
    log(`❌ Falha na autenticação: ${msg}`);
});

client.on("qr", (qr) => {
    currentQRCode = qr;
    isConnected = false;
    isReady = false;
    log("📲 NOVO QR CODE: Acesse o link do Railway para escanear.");
    qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
    log("✅ Bot Valéria Daré Conectado e PRONTO!");
    currentQRCode = null;
    isConnected = true;
    isReady = true; 
});

client.on("disconnected", async (reason) => {
    log(`⚠️ Cliente desconectado! Motivo: ${reason}`);
    isConnected = false;
    isReady = false;
    // Tenta reconectar
    setTimeout(() => {
        client.initialize().catch(e => log(e.message));
    }, 5000);
});

// =====================================
// LÓGICA DE MENSAGENS (FLUXO HUMANIZADO)
// =====================================
client.on("message", async (msg) => {
    try {
        // Filtros Iniciais
        if (!isReady) return; // Se ainda estiver carregando
        if (msg.timestamp < BOT_START_TIMESTAMP) return; // Se for mensagem velha
        
        if (!msg.from || msg.from.includes("status") || msg.from.includes("g.us")) return;
        if (msg.type === 'sticker') return;
        if (client.info && client.info.wid && msg.from === client.info.wid._serialized) return;

        console.log(`📩 Debug: Mensagem de ${msg.from}: "${msg.body}"`);

        const chat = await msg.getChat();
        const texto = msg.body.trim();
        const contactId = msg.from;
        const lowerText = texto.toLowerCase();

        // Recupera sessão do usuário
        let session = userSessions.get(contactId) || { step: 'IDLE', lastInteraction: Date.now() };
        session.lastInteraction = Date.now();
        userSessions.set(contactId, session);

        // Reset Global
        if (['cancelar', 'sair', 'reset', 'inicio', 'encerrar'].includes(lowerText)) {
            userSessions.delete(contactId);
            await client.sendMessage(contactId, "🔄 Atendimento reiniciado. Envie um 'Oi' quando precisar.");
            return;
        }

        if (session.step === 'COMPLETED') return;

        const reply = async (text) => {
            await chat.sendStateTyping();
            await delay(1500); 
            await client.sendMessage(contactId, text);
            await chat.clearState();
        };

        // PASSO 1: INÍCIO (SAUDAÇÃO)
        if (session.step === 'IDLE') {
            const saudacoesRegex = /(oi|olá|ola|bom dia|boa tarde|boa noite|tarde|dia|noite|opa|tudo bem|bot|ajuda)/i;
            
            if (!saudacoesRegex.test(texto)) {
                return;
            }

            session.step = 'WAITING_FOR_INFO';
            userSessions.set(contactId, session);
            
            await reply("Olá!");
            await reply("Você está entrando em contato com o Escritório Valéria Daré Advocacia.");
            await reply("Para iniciarmos, por favor, me informe seu nome e sobrenome.");
            return;
        }

        // PASSO 2: RECEBE NOME -> TRATA NOME -> MOSTRA MENU
        if (session.step === 'WAITING_FOR_INFO') {
            const infoCliente = texto;
            const primeiroPalavra = infoCliente.split(/[\s,]+/)[0];
            let nomeFormatado = primeiroPalavra.charAt(0).toUpperCase() + primeiroPalavra.slice(1).toLowerCase();

            // Lista inteligente para não chamar o cliente de "Oi" ou "Boa"
            const palavrasIgnoradas = [
                'oi', 'olá', 'ola', 'bom', 'boa', 'gostaria', 'queria', 'preciso', 'estou', 
                'sou', 'meu', 'não', 'nao', 'quero', 'assunto', 'sobre', 'tenho', 'necessito', 'favor'
            ];
            
            let saudacaoPersonalizada = "";
            let nomeParaSalvar = "Cliente"; 

            // Se o nome não for uma palavra genérica, usamos ele
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

        // PASSO 3: SELEÇÃO -> VALIDAÇÃO HUMANIZADA -> PEDE MOTIVO
        if (session.step === 'WAITING_FOR_SELECTION') {
            const numeroOpcao = texto.replace(/\D/g, ''); 
            const opcao = parseInt(numeroOpcao);
            let dept = null;

            if (numeroOpcao === '0' || texto === '0') {
                dept = GENERAL_ATTENDANCE;
            } else if (DEPARTMENTS[opcao]) {
                dept = DEPARTMENTS[opcao];
            } else {
                // Mensagem de erro mais educada
                await reply("Me desculpe, não entendi. Poderia por gentileza escolher o número da opção desejada?");
                return;
            }

            session.selectedDept = dept;
            session.step = 'WAITING_FOR_REASON';
            userSessions.set(contactId, session);

            const nome = session.clientName || "Cliente";
            // Pergunta humanizada
            await reply(`${nome}, se você pudesse resumir em poucas palavras a escolha desse assunto, qual seria?`);
            return;
        }

        // PASSO 4: FINALIZAÇÃO
        if (session.step === 'WAITING_FOR_REASON') {
            const motivo = texto; 
            const dept = session.selectedDept;

            // Mensagem final citando "Doutores"
            let msgFinal = `Perfeito! Já estamos te transferindo para um de nossos Doutores do *${dept.name}*.\n\n` +
                           `Aguarde um momento, por favor.`;

            if (!isBusinessHours()) {
                msgFinal += `\n\n🕒 *Atenção:* Estamos fora do horário comercial (09h às 18h). Seu atendimento será priorizado no próximo dia útil.`;
            }

            await reply(msgFinal);

            // Monta relatório para o advogado
            const linkWhats = `https://wa.me/${contactId.replace('@c.us', '')}`;
            const infoCompleta = `Info Inicial: ${session.clientInfo}\n📝 *Resumo do Cliente:* ${motivo}`;

            const relatorio = `🚨 *NOVO LEAD: ${dept.name}*\n\n` +
                              `👤 *Cliente:* ${session.clientName}\n` +
                              `💬 *Detalhes:* ${infoCompleta}\n` +
                              `📞 *Whatsapp:* ${linkWhats}\n` +
                              `📅 *Data:* ${new Date().toLocaleString('pt-BR')}\n\n` +
                              `💡 *Ação:* Entrar em contato.`;

            log(`Encaminhando lead para: ${dept.responsavel_nome}`);

            // Envia para o advogado responsável
            if (dept.responsavel_id) {
                setTimeout(async () => {
                    try {
                        await client.sendMessage(dept.responsavel_id, relatorio);
                    } catch (e) {
                        log(`Erro ao notificar advogado: ${e.message}`);
                    }
                }, 2000);
            }

            // Webhook
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
        log(`❌ Erro no fluxo: ${error}`);
    }
});

// =====================================
// SERVIDOR WEB (QR CODE)
// =====================================
app.get('/', async (req, res) => {
    const refreshScript = `<script>setTimeout(function(){location.reload()}, 5000);</script>`;
    if (isConnected) {
        res.send(`<h1 style="color:green;text-align:center;font-family:sans-serif">✅ WhatsApp Conectado!</h1>`);
    } else if (currentQRCode) {
        try {
            const url = await qrcodeImage.toDataURL(currentQRCode);
            res.send(`
                <div style="text-align:center;font-family:sans-serif">
                    <h1>📲 Escaneie o QR Code</h1>
                    <img src="${url}" width="300"/>
                    <p>A página atualiza sozinha.</p>
                    ${refreshScript}
                </div>
            `);
        } catch (err) { res.send('Erro ao gerar imagem.'); }
    } else {
        res.send(`<div style="text-align:center;font-family:sans-serif"><h1>🔄 Inicializando...</h1><p>Aguarde...</p>${refreshScript}</div>`);
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
