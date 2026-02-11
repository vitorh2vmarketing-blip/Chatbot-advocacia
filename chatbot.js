// ============================================================
// BOT VALÉRIA DARÉ - VERSÃO FINAL (ENTREGA RAILWAY/CLOUD)
// ============================================================
// Recursos:
// - Memória de Clientes (Reconhece quem volta)
// - Agendamento Google Calendar
// - Proteção Anti-Crash (Não cai com erros de rede)
// - Alerta Interno (Bolinha verde + Aviso no "Eu")
// - Filtro Anti-Spam (Ignora mensagens apagadas/sistema)
// - Configurado para Docker/Railway (Headless True)
// ============================================================

require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');
const qrcodeImage = require('qrcode');
const fs = require('fs');
const path = require('path');

// =====================================
// PROTEÇÃO CONTRA FALHAS
// =====================================
process.on('unhandledRejection', (reason, p) => {
    console.log('⚠️ ERRO DE PROTOCOLO (Sistema mantido online):', reason.message || reason);
});
process.on('uncaughtException', (err) => {
    console.log('⚠️ ERRO CRÍTICO (Sistema mantido online):', err.message || err);
});

// =====================================
// CONFIGURAÇÕES
// =====================================
const PORT = process.env.PORT || 3000;
const API_URL = "https://webhook.site/cc903f72-48a6-47a1-bb06-c89f5c6eefe2";
const WORK_HOUR_START = 9;
const WORK_HOUR_END = 18;
const GOOGLE_AGENDA_LINK = "https://calendar.app.google/HCshHssc9GugZBaCA"; 

// --- CONFIGURAÇÃO DE PERSISTÊNCIA (RAILWAY) ---
// Se houver um volume montado no Railway, usamos ele. Senão, usamos a pasta local.
// No Railway, crie um Volume e monte em "/app/data" para salvar o login.
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH 
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'data') 
    : path.join(__dirname, 'data');

// Garante que a pasta de dados existe
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Arquivos salvos dentro da pasta segura
const DB_FILE = path.join(DATA_DIR, 'clientes_db.json');
const AUTH_PATH = path.join(DATA_DIR, '.wwebjs_auth');

// Cria o DB se não existir
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({}));
}

const BOT_START_TIMESTAMP = Math.floor(Date.now() / 1000);
const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

log(`🕒 Bot iniciado. Diretório de dados: ${DATA_DIR}`);

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
        const data = JSON.parse(fs.readFileSync(DB_FILE));
        return data[telefone];
    } catch (e) {
        return null;
    }
}

function salvarCliente(telefone, nome) {
    try {
        let data = JSON.parse(fs.readFileSync(DB_FILE));
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
    // Ajuste de fuso horário para o Brasil (UTC-3) pois o servidor pode estar nos EUA
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
            // Limpeza silenciosa para evitar spam em reinicios
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
        dataPath: AUTH_PATH // Usa o caminho persistente no Volume
    }),
    webVersionCache: { type: 'none' }, 
    puppeteer: {
        headless: true, // OBRIGATÓRIO SER TRUE NA NUVEM/RAILWAY
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage", // Evita crash de memória no Docker
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
    log("📲 QR CODE GERADO! Escaneie pelo site.");
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
        if (fs.existsSync(AUTH_PATH)) fs.rmSync(AUTH_PATH, { recursive: true, force: true });
    } catch (e) {}
});

client.on('disconnected', (reason) => {
    log(`❌ Desconectado: ${reason}`);
    isConnected = false;
});

// =====================================
// LÓGICA DE MENSAGENS (COM RECONHECIMENTO)
// =====================================
client.on('message', async (msg) => {
    try {
        const tipoMsg = msg.type;
        const deQuem = msg.from;
        const ehGrupo = deQuem.endsWith('@g.us');
        const ehStatus = msg.isStatus;
        
        log(`📩 Debug: Recebi msg de ${deQuem} [Tipo: ${tipoMsg}] -> "${msg.body}"`);

        // =======================================================
        // FILTROS DE SEGURANÇA (EVITAR SPAM AO DELETAR MSG)
        // =======================================================
        if (msg.timestamp < BOT_START_TIMESTAMP) return;
        if (!deQuem || ehGrupo || ehStatus) return;
        if (deQuem === client.info?.wid?._serialized) return;

        // Lista negra de tipos de mensagens técnicas que NÃO devem gerar resposta
        const tiposIgnorados = [
            'e2e_notification', // Aviso de segurança
            'notification_template', // Avisos de sistema
            'call_log', // Registro de chamada
            'protocol', // Atualização de protocolo
            'ciphertext', // Mensagem ilegível
            'revoked', // Mensagem apagada
            'gp2', // Convite de grupo
            'sticker' // Figurinhas (Opcional, mas bom manter)
        ];

        if (tiposIgnorados.includes(tipoMsg)) {
            console.log(`🚫 Ignorado: Mensagem de sistema (${tipoMsg})`);
            return;
        }

        // Ignora mensagens vazias (comuns quando se apaga msg ou envia mídia sem legenda)
        if (!msg.body || msg.body.trim().length === 0) {
            console.log("🚫 Ignorado: Corpo da mensagem vazio.");
            return;
        }

        const chat = await msg.getChat();
        const contactId = msg.from;
        const texto = msg.body.trim();
        const lowerText = texto.toLowerCase();

        // Recupera sessão ativa
        let session = userSessions.get(contactId) || { step: 'IDLE', lastInteraction: Date.now() };

        // Regex de saudação (Com limite de palavra \b para evitar "Higor" = "Hi")
        const saudacaoRegex = /^(oi+|ol[áa]+|opa+|eai|hello|hi|b[ou]m\s+dia|boa\s+tarde|boa\s+noite|tudo\s+bem|iniciar|começar|reset|sair|cancelar|encerrar|fim|doutora|dra)\b/i;
        
        if (saudacaoRegex.test(lowerText)) {
            // Se estiver no menu de retorno (1 ou 2), não reseta imediatamente
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

        // 1. Início (Verifica se cliente já existe)
        if (session.step === 'IDLE') {
            const clienteSalvo = getClienteSalvo(contactId.replace('@c.us', ''));
            
            // CASO 1: CLIENTE JÁ CONHECIDO (RETORNO)
            if (clienteSalvo && clienteSalvo.nome) {
                log(`👤 Cliente reconhecido: ${clienteSalvo.nome}`);
                session.clientName = clienteSalvo.nome;
                session.clientInfo = clienteSalvo.nome; 
                session.step = 'RETURNING_USER'; 
                userSessions.set(contactId, session);

                await reply(`Olá novamente, *${clienteSalvo.nome}*! 👋\nQue bom ter você de volta.\n\nComo posso ajudar hoje?\n\n1️⃣ - Falar sobre o caso anterior (Falar com atendente)\n2️⃣ - Iniciar um novo atendimento (Ver Menu)`);
                return;
            }

            // CASO 2: CLIENTE NOVO
            session.step = 'WAITING_FOR_INFO';
            userSessions.set(contactId, session);
            await reply("Olá! Você está entrando em contato com o Escritório Valéria Daré Advocacia.\n\nPara iniciarmos, por gentileza, me informe seu Nome e Sobrenome.");
            return;
        }

        // 1.5 Decisão do Cliente Retornante
        if (session.step === 'RETURNING_USER') {
            const opcao = texto.replace(/\D/g, ''); 

            if (opcao === '1') {
                const dept = DEPARTMENTS[5]; // "Outros" / Geral
                session.selectedDept = dept;
                
                await reply(`Entendido, ${session.clientName}. Vou avisar nossa equipe que você deseja continuar o atendimento.`);
                
                session.motivo = "Cliente retornante: Continuidade de atendimento";
                // Finaliza fluxo para marcar notificação
                session.step = 'WAITING_FOR_SCHEDULING'; // Pula para a etapa de finalização
                
                const linkZap = `https://wa.me/${contactId.replace('@c.us', '')}`;
                
                // ALERTA INTERNO
                await chat.markUnread();
                const meuNumero = client.info.wid._serialized;
                const alertaInterno = `🚨 *CLIENTE RETORNANTE* 🚨\n\n` +
                                      `👤 *Nome:* ${session.clientName}\n` +
                                      `📝 *Pedido:* Continuidade de atendimento\n` +
                                      `🔗 *Link:* ${linkZap}`;
                await client.sendMessage(meuNumero, alertaInterno);

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

        // 2. Recebe Nome (Só para novos)
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

        // 3. Escolha do Menu
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

        // 4. Recebe Motivo -> Pergunta Agendamento
        if (session.step === 'WAITING_FOR_REASON') {
            session.motivo = texto;
            session.step = 'WAITING_FOR_SCHEDULING';
            userSessions.set(contactId, session);
            
            // Pergunta mais humanizada e flexível
            await reply("Entendi perfeitamente. \n\nPara agilizarmos o seu atendimento, você já gostaria de deixar uma reunião agendada com a nossa equipe? (Pode responder como preferir, ex: 'Sim', 'Por favor', 'Pode ser')");
            return;
        }

        // 5. Agendamento -> Fim
        if (session.step === 'WAITING_FOR_SCHEDULING') {
            const dept = session.selectedDept;
            const motivo = session.motivo;
            const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
            
            // Regex expandido para entender "humanês" (aceita "por favor", "pode ser", etc)
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

            // SALVA O CLIENTE NA MEMÓRIA
            salvarCliente(contactId.replace('@c.us', ''), session.clientName);

            // ============================================
            // ALERTA INTERNO (PARA O ATENDENTE DO BOT)
            // ============================================
            
            // 1. Marca a conversa do cliente como "NÃO LIDA" (Bolinha verde)
            try {
                await chat.markUnread();
            } catch (e) {
                console.error("Erro ao marcar como não lida:", e.message);
            }

            // 2. Envia notificação para o "Eu" (Anotações do WhatsApp)
            try {
                const meuNumero = client.info.wid._serialized;
                const linkZap = `https://wa.me/${contactId.replace('@c.us', '')}`;
                
                const alertaInterno = `🚨 *NOVA TRIAGEM FINALIZADA* 🚨\n\n` +
                                      `👤 *Cliente:* ${session.clientName}\n` +
                                      `📂 *Dept:* ${dept.name}\n` +
                                      `📝 *Resumo:* ${motivo}\n` +
                                      `🔗 *Clique para atender:* ${linkZap}`;
                
                await client.sendMessage(meuNumero, alertaInterno);
            } catch (e) {
                console.error("Erro ao enviar alerta interno:", e.message);
            }

            // REMOVIDO: Notificação externa para advogado, para centralizar no número do bot.
            
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
// SERVIDOR WEB (PAINEL)
// =====================================
app.get('/', async (req, res) => {
    if (isConnected) res.send('<h1 style="color:green; font-family:sans-serif">✅ Bot Valéria Daré Online!</h1>');
    else if (currentQRCode) {
        const url = await qrcodeImage.toDataURL(currentQRCode);
        res.send(`<div style="text-align:center; font-family:sans-serif"><h1>Escaneie para conectar</h1><img src="${url}" /><script>setTimeout(()=>location.reload(),5000)</script></div>`);
    } else res.send('<h1>Iniciando sistema...</h1><script>setTimeout(()=>location.reload(),3000)</script>');
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
