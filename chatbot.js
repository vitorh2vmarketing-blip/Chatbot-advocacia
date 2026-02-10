// ============================================================
// BOT VALÉRIA DARÉ - VERSÃO CLOUD (RAILWAY/LINUX)
// ============================================================

require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const qrcodeImage = require('qrcode');
const fs = require('fs');
const path = require('path');

// =====================================
// PROTEÇÃO CONTRA CRASH
// =====================================
process.on('unhandledRejection', (reason, p) => {
    console.log('⚠️ ERRO DE PROTOCOLO (Ignorado):', reason.message || reason);
});
process.on('uncaughtException', (err) => {
    console.log('⚠️ ERRO CRÍTICO (Ignorado):', err.message || err);
});

// =====================================
// CONFIGURAÇÕES
// =====================================
const PORT = process.env.PORT || 3000;
const API_URL = "https://webhook.site/cc903f72-48a6-47a1-bb06-c89f5c6eefe2";
const WORK_HOUR_START = 9;
const WORK_HOUR_END = 18;
const GOOGLE_AGENDA_LINK = "https://calendar.app.google/HCshHssc9GugZBaCA"; 

// CAMINHO DOS DADOS (Para persistência na nuvem)
// No Railway, montaremos um volume para não perder dados ao reiniciar
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const DB_FILE = path.join(DATA_DIR, 'clientes_db.json');
const AUTH_DIR = path.join(DATA_DIR, '.wwebjs_auth');

// Garante que o arquivo de banco de dados existe
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({}));
}

const BOT_START_TIMESTAMP = Math.floor(Date.now() / 1000);
const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

log(`🕒 Bot iniciado em ambiente Cloud/Local.`);

// =====================================
// DEPARTAMENTOS
// =====================================
const ADVOGADA_RESPONSAVEL = { nome: "Dra. Valéria Daré", id: "5511913431522@c.us" };
const ATENDENTE_GERAL = { nome: "Valkiria Dragone", id: "35999672058@c.us" };

const DEPARTMENTS = {
    1: { name: "BPC / LOAS para Autistas", responsavel_nome: ADVOGADA_RESPONSAVEL.nome, responsavel_id: ADVOGADA_RESPONSAVEL.id },
    2: { name: "Direitos da Pessoa com Fibromialgia", responsavel_nome: ADVOGADA_RESPONSAVEL.nome, responsavel_id: ADVOGADA_RESPONSAVEL.id },
    3: { name: "Auxílio Acidente (Acidente do Trabalho)", responsavel_nome: ADVOGADA_RESPONSAVEL.nome, responsavel_id: ADVOGADA_RESPONSAVEL.id },
    4: { name: "Trabalhista - Acidente do Trabalho", responsavel_nome: ADVOGADA_RESPONSAVEL.nome, responsavel_id: ADVOGADA_RESPONSAVEL.id },
    5: { name: "Outros", responsavel_nome: ATENDENTE_GERAL.nome, responsavel_id: ATENDENTE_GERAL.id }
};

// =====================================
// ESTADO E MEMÓRIA
// =====================================
const app = express();
let currentQRCode = null;
let isConnected = false;
const userSessions = new Map();

// --- SISTEMA DE MEMÓRIA ---
function getClienteSalvo(telefone) {
    try {
        if(fs.existsSync(DB_FILE)) {
            const data = JSON.parse(fs.readFileSync(DB_FILE));
            return data[telefone];
        }
        return null;
    } catch (e) {
        return null;
    }
}

function salvarCliente(telefone, nome) {
    try {
        let data = {};
        if(fs.existsSync(DB_FILE)) {
            data = JSON.parse(fs.readFileSync(DB_FILE));
        }
        data[telefone] = { 
            nome: nome, 
            ultimo_contato: new Date().toISOString() 
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Erro ao salvar cliente:", e.message);
    }
}

// =====================================
// FUNÇÕES AUXILIARES
// =====================================
function isBusinessHours() {
    const agora = new Date();
    // Ajuste de fuso horário para o Brasil (UTC-3) caso o servidor esteja fora
    const horaBrasilia = new Date(agora.toLocaleString("en-US", {timeZone: "America/Sao_Paulo"}));
    
    const diaSemana = horaBrasilia.getDay(); 
    const hora = horaBrasilia.getHours();
    return (diaSemana >= 1 && diaSemana <= 5) && (hora >= WORK_HOUR_START && hora < WORK_HOUR_END);
}

// =====================================
// GERENCIADOR DE INATIVIDADE
// =====================================
setInterval(async () => {
    const now = Date.now();
    const TEMPO_LIMITE = 30 * 60 * 1000; // 30 minutos

    for (const [key, session] of userSessions.entries()) {
        const tempoInativo = now - session.lastInteraction;

        if (tempoInativo > TEMPO_LIMITE) {
            // Remove a mensagem de encerramento para evitar spam se o bot reiniciar, 
            // apenas limpa a sessão silenciosamente.
            userSessions.delete(key);
        }
    }
}, 60000);

async function enviarDadosParaAPI(dados) {
    if (!API_URL || API_URL.includes("seu-link")) return;
    try {
        if (typeof fetch === 'undefined') return;
        await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(dados)
        });
    } catch (error) {
        console.error("Erro Webhook:", error.message);
    }
}

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// =====================================
// CLIENTE WHATSAPP
// =====================================
const client = new Client({
    authStrategy: new LocalAuth({ 
        clientId: "valeria_bot",
        dataPath: AUTH_DIR // Usa o caminho persistente
    }),
    webVersionCache: { type: 'none' },
    puppeteer: {
        headless: true, // Na nuvem precisa ser true (sem janela)
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage", // Essencial para Docker/Cloud
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--disable-gpu",
            "--disable-extensions"
        ]
    }
});

// --- EVENTOS ---

client.on('qr', (qr) => {
    currentQRCode = qr;
    isConnected = false;
    log("📲 QR CODE GERADO! Acesse a URL do bot para escanear.");
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    log("✅ TUDO PRONTO! O Bot está online.");
    currentQRCode = null;
    isConnected = true;
});

client.on('authenticated', () => {
    log("🔐 Sessão autenticada.");
});

client.on('auth_failure', (msg) => {
    log(`❌ Falha na autenticação: ${msg}`);
    try {
        if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    } catch (e) {}
});

client.on('disconnected', (reason) => {
    log(`❌ Desconectado: ${reason}`);
    isConnected = false;
});

// =====================================
// LÓGICA DE MENSAGENS
// =====================================
client.on('message', async (msg) => {
    try {
        const tipoMsg = msg.type;
        const deQuem = msg.from;
        const ehGrupo = deQuem.endsWith('@g.us');
        const ehStatus = msg.isStatus;
        
        log(`📩 Debug: Recebi msg de ${deQuem} -> "${msg.body}"`);

        if (msg.timestamp < BOT_START_TIMESTAMP) return;
        if (!deQuem || ehGrupo || ehStatus) return;
        if (tipoMsg === 'sticker') return;
        if (deQuem === client.info?.wid?._serialized) return;

        const chat = await msg.getChat();
        const contactId = msg.from;
        const texto = msg.body.trim();
        const lowerText = texto.toLowerCase();

        let session = userSessions.get(contactId) || { step: 'IDLE', lastInteraction: Date.now() };

        // Regex de saudação
        const saudacaoRegex = /^(oi+|ol[áa]+|opa+|eai|hello|hi|b[ou]m\s+dia|boa\s+tarde|boa\s+noite|tudo\s+bem|iniciar|começar|reset|sair|cancelar|encerrar|fim|doutora|dra)\b/i;
        
        if (saudacaoRegex.test(lowerText)) {
            if (session.step !== 'IDLE' && session.step !== 'RETURNING_USER') {
                session = { step: 'IDLE', lastInteraction: Date.now() };
                userSessions.set(contactId, session);
            }
        } else {
            session.lastInteraction = Date.now();
        }
        userSessions.set(contactId, session);

        if (session.step === 'COMPLETED') return;

        const reply = async (txt) => {
            await chat.sendStateTyping();
            await delay(1000 + Math.random() * 1000);
            await client.sendMessage(contactId, txt);
        };

        // --- FLUXO INTELIGENTE ---

        if (session.step === 'IDLE') {
            const clienteSalvo = getClienteSalvo(contactId.replace('@c.us', ''));
            
            if (clienteSalvo && clienteSalvo.nome) {
                session.clientName = clienteSalvo.nome;
                session.clientInfo = clienteSalvo.nome; 
                session.step = 'RETURNING_USER'; 
                userSessions.set(contactId, session);

                await reply(`Olá novamente, *${clienteSalvo.nome}*! 👋\nQue bom ter você de volta.\n\nComo posso ajudar hoje?\n\n1️⃣ - Falar sobre o caso anterior (Falar com atendente)\n2️⃣ - Iniciar um novo atendimento (Ver Menu)`);
                return;
            }

            session.step = 'WAITING_FOR_INFO';
            userSessions.set(contactId, session);
            await reply("Olá! Você está entrando em contato com o Escritório Valéria Daré Advocacia.\n\nPara iniciarmos, por gentileza, me informe seu Nome e Sobrenome.");
            return;
        }

        if (session.step === 'RETURNING_USER') {
            const opcao = texto.replace(/\D/g, ''); 

            if (opcao === '1') {
                const dept = DEPARTMENTS[5];
                session.selectedDept = dept;
                await reply(`Entendido, ${session.clientName}. Vou avisar nossa equipe que você deseja continuar o atendimento.`);
                
                session.motivo = "Cliente retornante: Continuidade de atendimento";
                session.step = 'WAITING_FOR_SCHEDULING';
                
                const linkZap = `https://wa.me/${contactId.replace('@c.us', '')}`;
                
                try {
                    await chat.markUnread();
                    const meuNumero = client.info.wid._serialized;
                    const alertaInterno = `🚨 *CLIENTE RETORNANTE* 🚨\n\n` +
                                          `👤 *Nome:* ${session.clientName}\n` +
                                          `📝 *Pedido:* Continuidade de atendimento\n` +
                                          `🔗 *Link:* ${linkZap}`;
                    await client.sendMessage(meuNumero, alertaInterno);
                } catch(e) {}

                session.step = 'COMPLETED';
                userSessions.set(contactId, session);
                return;

            } else if (opcao === '2') {
                let menu = `Perfeito, ${session.clientName}. Selecione o assunto:\n\n`;
                Object.keys(DEPARTMENTS).forEach(key => {
                    menu += `*${key}* - ${DEPARTMENTS[key].name}\n`;
                });
                
                session.step = 'WAITING_FOR_SELECTION';
                userSessions.set(contactId, session);
                await reply(menu);
                return;

            } else {
                await reply("Por favor, digite *1* para continuar o anterior ou *2* para novo assunto.");
                return;
            }
        }

        if (session.step === 'WAITING_FOR_INFO') {
            const nome = texto.split(" ")[0];
            if (texto.length < 3) {
                await reply("Nome muito curto. Por favor, digite seu nome completo.");
                return;
            }

            session.clientInfo = texto; 
            session.clientName = nome;

            let menu = `Certo, ${nome}! Como podemos te ajudar hoje?\n\n` +
                       `Por gentileza, digite o NÚMERO da opção desejada:\n\n`;
            Object.keys(DEPARTMENTS).forEach(key => {
                menu += `*${key}* - ${DEPARTMENTS[key].name}\n`;
            });

            session.step = 'WAITING_FOR_SELECTION';
            userSessions.set(contactId, session);
            await reply(menu);
            return;
        }

        if (session.step === 'WAITING_FOR_SELECTION') {
            const opcao = parseInt(texto.replace(/\D/g, ''));
            let dept = null;

            if (DEPARTMENTS[opcao]) {
                dept = DEPARTMENTS[opcao];
            } else {
                await reply("Desculpe, não entendi.\nPoderia por gentileza digitar novamente o NÚMERO da opção desejada? (ex: 1, 2, 3...).");
                return;
            }

            session.selectedDept = dept;
            session.step = 'WAITING_FOR_REASON';
            userSessions.set(contactId, session);
            await reply(`Ok, ${session.clientName}. Se você pudesse resumir em poucas palavras a escolha desse assunto, qual seria?`);
            return;
        }

        if (session.step === 'WAITING_FOR_REASON') {
            session.motivo = texto;
            session.step = 'WAITING_FOR_SCHEDULING';
            userSessions.set(contactId, session);
            
            await reply("Entendi perfeitamente. \n\nPara agilizarmos o seu atendimento, você já gostaria de deixar uma reunião agendada com a nossa equipe? (Pode responder como preferir, ex: 'Sim', 'Por favor', 'Pode ser')");
            return;
        }

        if (session.step === 'WAITING_FOR_SCHEDULING') {
            const dept = session.selectedDept;
            const motivo = session.motivo;
            const querAgendar = /^(sim|s|claro|com certeza|quero|aham|yes|pode ser|por favor|gostaria|agendar|ok|tá bom|beleza|topo|pode|pode sim|uhum|com certeza)/i.test(lowerText);

            let msgFinal = `Perfeito, já estamos transferindo o seu atendimento para o responsável de: *${dept.name}*.\n\n` +
                           `Aguarde um momento, por gentileza.`;

            if (querAgendar && GOOGLE_AGENDA_LINK) {
                msgFinal += `\n\n📅 *Agendamento:* Como você optou por agendar, acesse o link abaixo para escolher o melhor horário:\n${GOOGLE_AGENDA_LINK}`;
            }

            if (!isBusinessHours()) {
                msgFinal += `\n\n🕒 *Nota:* Estamos fora do nosso horário comercial (09h-18h). Responderemos seu caso o mais rápido possível.`;
            }

            await reply(msgFinal);
            salvarCliente(contactId.replace('@c.us', ''), session.clientName);

            try {
                await chat.markUnread();
                const meuNumero = client.info.wid._serialized;
                const linkZap = `https://wa.me/${contactId.replace('@c.us', '')}`;
                
                const alertaInterno = `🚨 *NOVA TRIAGEM FINALIZADA* 🚨\n\n` +
                                      `👤 *Cliente:* ${session.clientName}\n` +
                                      `📂 *Dept:* ${dept.name}\n` +
                                      `📝 *Resumo:* ${motivo}\n` +
                                      `🔗 *Clique para atender:* ${linkZap}`;
                
                await client.sendMessage(meuNumero, alertaInterno);
            } catch (e) {}

            enviarDadosParaAPI({
                telefone: contactId.replace('@c.us', ''),
                nome: session.clientInfo,
                motivo: motivo,
                departamento: dept.name,
                data: new Date().toISOString()
            });

            session.step = 'COMPLETED';
            userSessions.set(contactId, session);
        }

    } catch (e) {
        console.error("Erro fatal no fluxo de mensagem:", e);
    }
});

// =====================================
// SERVIDOR WEB (PAINEL DO RAILWAY)
// =====================================
app.get('/', async (req, res) => {
    if (isConnected) res.send('<h1 style="color:green; font-family:sans-serif">✅ Bot Valéria Daré Online e Ativo!</h1>');
    else if (currentQRCode) {
        // Exibe o QR Code na tela para facilitar o login remoto
        const url = await qrcodeImage.toDataURL(currentQRCode);
        res.send(`<div style="text-align:center; font-family:sans-serif">
            <h1>Escaneie o QR Code para conectar</h1>
            <img src="${url}" />
            <p>A página atualiza a cada 5 segundos...</p>
            <script>setTimeout(()=>location.reload(),5000)</script>
        </div>`);
    } else res.send('<h1 style="font-family:sans-serif">Iniciando sistema... Aguarde.</h1><script>setTimeout(()=>location.reload(),3000)</script>');
});

app.listen(PORT, () => log(`🌐 Painel rodando na porta ${PORT}`));

const startBot = async () => {
    try {
        await client.initialize();
    } catch (err) {
        console.error("❌ Erro na inicialização. Tentando novamente em 5s...", err.message);
        setTimeout(startBot, 5000);
    }
};

startBot();
