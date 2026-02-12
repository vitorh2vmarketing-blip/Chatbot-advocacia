// ============================================================
// BOT VALÉRIA DARÉ - VERSÃO FINAL (ENTREGA 1.0)
// ============================================================
// Recursos:
// - Textos revisados conforme roteiro (chatbot.docx)
// - Menu numérico final para agendamento
// - Proteção Anti-Crash e Persistência de Dados
// - Configurado para Railway (Headless True)
// - CORREÇÃO: Busca robusta do chat "Eu" (Anotações)
// ============================================================

// ------------------------------------------------------------
// ⚠️ INSTRUÇÃO PARA NÃO DESCONECTAR NO RAILWAY ⚠️
// ------------------------------------------------------------
// 1. No painel do Railway, clique no seu projeto.
// 2. Vá na aba "Volumes" (ou clique com botão direito no retângulo do serviço > Volume).
// 3. Clique em "Create Volume" (Criar Volume).
// 4. No campo "Mount Path" (Caminho de Montagem), escreva exatamente: /app/data
// 5. Reinicie o bot (Redeploy).
// ------------------------------------------------------------

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
// ATENÇÃO: Webhook de teste. Para produção, troque se necessário.
const API_URL = "https://webhook.site/cc903f72-48a6-47a1-bb06-c89f5c6eefe2";
const WORK_HOUR_START = 9;
const WORK_HOUR_END = 18;
const GOOGLE_AGENDA_LINK = "https://calendar.app.google/HCshHssc9GugZBaCA"; 

// --- CONFIGURAÇÃO DE PERSISTÊNCIA (RAILWAY) ---
// Define onde os dados serão salvos.
// Se estiver no Railway com Volume, usa o caminho do volume. Se for local, usa a pasta 'data'.
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH 
    ? process.env.RAILWAY_VOLUME_MOUNT_PATH 
    : path.join(__dirname, 'data');

// Garante que a pasta de dados existe
if (!fs.existsSync(DATA_DIR)) {
    try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch (e) {
        console.error('Erro ao criar diretório de dados:', e);
    }
}

const DB_FILE = path.join(DATA_DIR, 'clientes_db.json');
// A pasta .wwebjs_auth deve ficar DENTRO do volume para não ser apagada
const AUTH_PATH = path.join(DATA_DIR, '.wwebjs_auth');

if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({}));
}

const BOT_START_TIMESTAMP = Math.floor(Date.now() / 1000);
const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

log(`🕒 Bot iniciado. Salvando sessão em: ${AUTH_PATH}`);

// =====================================
// DEPARTAMENTOS
// =====================================
const ADVOGADA_RESPONSAVEL = { nome: "Dra. Valéria Daré", id: "5511913431522@c.us" };
const ATENDENTE_GERAL = { nome: "Valkiria Dragone", id: "35999672058@c.us" };

const DEPARTMENTS = {
    1: { name: "BPC / LOAS para Autistas", responsavel_nome: ADVOGADA_RESPONSAVEL.nome, responsavel_id: ADVOGADA_RESPONSAVEL.id },
    2: { name: "Direitos da Pessoa com Fibromialgia", responsavel_nome: ADVOGADA_RESPONSAVEL.nome, responsavel_id: ADVOGADA_RESPONSAVEL.id },
    3: { name: "Auxílio Acidente - Acidente de qualquer natureza", responsavel_nome: ADVOGADA_RESPONSAVEL.nome, responsavel_id: ADVOGADA_RESPONSAVEL.id },
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
    // Ajuste UTC-3 (Brasil)
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
    const TEMPO_AVISO = 15 * 60 * 1000;  // 15 min
    const TEMPO_LIMITE = 30 * 60 * 1000; // 30 min

    for (const [key, session] of userSessions.entries()) {
        const tempoInativo = now - session.lastInteraction;

        // Aviso de 15 minutos
        if (tempoInativo > TEMPO_AVISO && !session.avisoInatividadeEnviado) {
            if (session.step !== 'IDLE' && session.step !== 'COMPLETED') {
                try {
                    await client.sendMessage(key, "Importante: Caso não haja retorno em até 30 minutos, a conversa será reiniciada.");
                    session.avisoInatividadeEnviado = true;
                    userSessions.set(key, session);
                } catch (e) {}
            }
        }

        // Reset de 30 minutos
        if (tempoInativo > TEMPO_LIMITE) {
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
        dataPath: AUTH_PATH 
    }),
    webVersionCache: { type: 'none' }, 
    puppeteer: {
        headless: true, // OBRIGATÓRIO PARA NUVEM
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage", 
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
    log("📲 QR CODE GERADO! Acesse o painel web para escanear.");
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
    // ATENÇÃO: Removi a exclusão automática da pasta para evitar perda de sessão
    // se o erro for apenas temporário durante a atualização.
    // try {
    //    if (fs.existsSync(AUTH_PATH)) fs.rmSync(AUTH_PATH, { recursive: true, force: true });
    // } catch (e) {}
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

        // FILTROS DE SEGURANÇA
        if (msg.timestamp < BOT_START_TIMESTAMP) return;
        if (!deQuem || ehGrupo || ehStatus) return;
        if (deQuem === client.info?.wid?._serialized) return;

        const tiposIgnorados = ['e2e_notification', 'notification_template', 'call_log', 'protocol', 'ciphertext', 'revoked', 'gp2', 'sticker'];
        if (tiposIgnorados.includes(tipoMsg)) return;
        if (!msg.body || msg.body.trim().length === 0) return;

        const chat = await msg.getChat();
        const contactId = msg.from;
        const texto = msg.body.trim();
        const lowerText = texto.toLowerCase();

        let session = userSessions.get(contactId) || { step: 'IDLE', lastInteraction: Date.now() };

        // Reseta aviso se usuário interagiu
        session.lastInteraction = Date.now();
        session.avisoInatividadeEnviado = false; 

        const saudacaoRegex = /^(oi+|ol[áa]+|opa+|eai|hello|hi|b[ou]m\s+dia|boa\s+tarde|boa\s+noite|tudo\s+bem|iniciar|começar|reset|sair|cancelar|encerrar|fim|doutora|dra)\b/i;
        
        if (saudacaoRegex.test(lowerText)) {
            if (session.step !== 'IDLE' && session.step !== 'RETURNING_USER') {
                session = { step: 'IDLE', lastInteraction: Date.now() };
                userSessions.set(contactId, session);
            }
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
            
            // CLIENTE RETORNANTE
            if (clienteSalvo && clienteSalvo.nome) {
                log(`👤 Cliente reconhecido: ${clienteSalvo.nome}`);
                session.clientName = clienteSalvo.nome;
                session.clientInfo = clienteSalvo.nome; 
                session.step = 'RETURNING_USER'; 
                userSessions.set(contactId, session);

                await reply(`Olá, *${clienteSalvo.nome}*! 👋\nQue bom ter você de volta.\n\nComo posso ajudar hoje?\n\n1️⃣ - Falar sobre o caso anterior\n2️⃣ - Iniciar um novo atendimento (Menu)`);
                return;
            }

            // CLIENTE NOVO
            session.step = 'WAITING_FOR_INFO';
            userSessions.set(contactId, session);
            await reply("Olá!");
            await reply("Você está entrando em contato com o Escritório Valéria Daré Advocacia.");
            await reply("Para iniciarmos, por gentileza, me informe seu *nome e sobrenome*.");
            return;
        }

        if (session.step === 'RETURNING_USER') {
            const opcao = texto.replace(/\D/g, ''); 

            if (opcao === '1') {
                const dept = DEPARTMENTS[5];
                session.selectedDept = dept;
                
                await reply(`Entendido, ${session.clientName}. Vou avisar nossa equipe que você deseja continuar o atendimento.`);
                
                session.motivo = "Retorno de Cliente: Continuidade de atendimento";
                session.step = 'WAITING_FOR_SCHEDULING'; 
                
                // --- ALERTA INTERNO ROBUSTO (PARA RETORNO) ---
                try {
                    await chat.markUnread();
                    // Busca o contato do próprio bot para garantir que achamos o chat certo ("Você")
                    const contatoProprio = await client.getContactById(client.info.wid._serialized);
                    const chatProprio = await contatoProprio.getChat();
                    
                    const linkZap = `https://wa.me/${contactId.replace('@c.us', '')}`;
                    const alertaInterno = `🚨 *CLIENTE RETORNANTE* 🚨\n\n` +
                                          `👤 *Nome:* ${session.clientName}\n` +
                                          `📝 *Pedido:* Continuidade de atendimento\n` +
                                          `🔗 *Link:* ${linkZap}`;
                                          
                    await chatProprio.sendMessage(alertaInterno);
                } catch(e) {
                    console.error("Erro alerta interno (retorno):", e.message);
                    // Fallback
                    try { await client.sendMessage(client.info.wid.user + '@c.us', `🚨 Alerta: Cliente retornou.`); } catch (e2) {}
                }

                session.step = 'COMPLETED';
                userSessions.set(contactId, session);
                return;

            } else if (opcao === '2') {
                // Vai para o menu
                let menu = `Certo, ${session.clientName}!\nComo podemos te ajudar hoje?\nPor gentileza, digite o NÚMERO da opção desejada:\n\n`;
                Object.keys(DEPARTMENTS).forEach(key => {
                    menu += `*${key}* - ${DEPARTMENTS[key].name}\n`;
                });
                
                session.step = 'WAITING_FOR_SELECTION';
                userSessions.set(contactId, session);
                await reply(menu);
                return;
            } else {
                await reply("Por favor, digite *1* para continuar ou *2* para novo assunto.");
                return;
            }
        }

        if (session.step === 'WAITING_FOR_INFO') {
            const nome = texto.split(" ")[0];
            if (texto.length < 3) {
                await reply("Nome muito curto");
                await reply("Por favor, digite seu nome completo.");
                return;
            }

            session.clientInfo = texto; 
            session.clientName = nome;

            let menu = `Certo, ${nome}!\nComo podemos te ajudar hoje?\nPor gentileza, digite o NÚMERO da opção desejada:\n\n`;
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
                await reply("Desculpe, não entendi");
                await reply("Poderia por gentileza, digitar apenas o *NÚMERO* da opção desejada?");
                return;
            }

            session.selectedDept = dept;
            session.step = 'WAITING_FOR_REASON';
            userSessions.set(contactId, session);
            await reply(`Ok, ${session.clientName}. Se pudesse resumir em poucas palavras a escolha desse assunto, qual seria?`);
            return;
        }

        // 4. Recebe Motivo -> Pergunta Agendamento (Com Menu 1 e 2)
        if (session.step === 'WAITING_FOR_REASON') {
            session.motivo = texto;
            session.step = 'WAITING_FOR_SCHEDULING';
            userSessions.set(contactId, session);
            
            // Mensagens divididas para melhor fluxo de leitura
            await reply("Perfeito.");
            await reply("Para agilizarmos o seu atendimento, gostaria de deixar uma reunião agendada com a nossa equipe?");
            await reply("Por gentileza, digite o NÚMERO da opção desejada:\n\n1 - Sim, por favor!\n2 - Quero falar com o atendente.");
            return;
        }

        // 5. Agendamento -> Fim
        if (session.step === 'WAITING_FOR_SCHEDULING') {
            const dept = session.selectedDept;
            const motivo = session.motivo;
            const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
            
            const opcao = texto.replace(/\D/g, ''); 

            if (opcao === '1') {
                await reply(`📅 *Agendamento:*\n\nComo você optou por agendar, acesse o link abaixo para escolher o melhor horário:\n${GOOGLE_AGENDA_LINK}`);
            } else if (opcao === '2') {
                await reply(`Perfeito, já estamos transferindo o seu atendimento para o responsável de: *${dept.name}*.`);
            } else {
                await reply("Por favor, digite apenas *1* (Sim) ou *2* (Falar com atendente).");
                return;
            }

            if (!isBusinessHours()) {
                await reply(`Excelente! Já anotamos tudo.\nEm breve terá nosso retorno.\n\n🕒 *Nota:* Estamos fora do horário comercial, responderemos assim que possível.`);
            } else {
                await reply(`Excelente! Já anotamos tudo.\nEm breve terá nosso retorno.`);
            }

            await delay(1000); 

            // SALVA O CLIENTE NA MEMÓRIA
            salvarCliente(contactId.replace('@c.us', ''), session.clientName);

            // --- ALERTA INTERNO ROBUSTO ---
            try {
                await chat.markUnread();
                
                // Busca o contato do próprio bot para garantir que achamos o chat certo ("Você")
                const contatoProprio = await client.getContactById(client.info.wid._serialized);
                const chatProprio = await contatoProprio.getChat();
                
                const linkZap = `https://wa.me/${contactId.replace('@c.us', '')}`;
                
                const alertaInterno = `🚨 *NOVA TRIAGEM FINALIZADA* 🚨\n\n` +
                                      `👤 *Cliente:* ${session.clientName}\n` +
                                      `📂 *Dept:* ${dept.name}\n` +
                                      `📝 *Resumo:* ${motivo}\n` +
                                      `📅 *Agendou?* ${opcao === '1' ? 'SIM (Link enviado)' : 'NÃO (Transferido)'}\n` +
                                      `🔗 *Clique para atender:* ${linkZap}`;
                
                await chatProprio.sendMessage(alertaInterno);
            } catch (e) {
                console.error("Erro alerta interno:", e.message);
                // Fallback: Tenta enviar usando o ID manual se a busca falhar
                try { await client.sendMessage(client.info.wid.user + '@c.us', `🚨 Alerta: Novo cliente finalizou triagem.`); } catch (e2) {}
            }

            enviarDadosParaAPI({
                telefone: contactId.replace('@c.us', ''),
                nome: session.clientInfo,
                motivo: motivo,
                departamento: dept.name,
                agendou: opcao === '1',
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
