# Usa a imagem oficial do Puppeteer (já vem com Chrome e Node prontos)
FROM ghcr.io/puppeteer/puppeteer:latest

# Define que vamos mexer nos arquivos como administrador (root)
USER root
WORKDIR /app

# Copia os arquivos de configuração
COPY package*.json ./

# Instala as dependências do seu robô
# A flag --ignore-scripts impede que o puppeteer tente baixar o Chrome de novo (já temos na imagem)
RUN npm install --ignore-scripts

# Copia o resto do código
COPY . .

# Importante: Dá permissão para o usuário do sistema escrever na pasta
# (Isso é crucial para salvar o arquivo de sessão do WhatsApp .wwebjs_auth)
RUN chown -R pptruser:pptruser /app

# === CORREÇÃO ESSENCIAL ===
# Recolocamos essas variáveis. Elas são obrigatórias para o seu chatbot.js
# saber onde está o Chrome no Linux e não travar tentando baixar outro.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Volta para o usuário padrão de segurança do Puppeteer
USER pptruser

# Inicia o robô com o nome CORRETO do seu arquivo
CMD ["node", "chatbot.js"]
