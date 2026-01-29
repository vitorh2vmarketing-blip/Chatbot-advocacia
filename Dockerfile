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

# === CORREÇÃO ===
# Removemos a linha ENV PUPPETEER_EXECUTABLE_PATH manual.
# A imagem oficial já configura isso automaticamente para o caminho certo.

# Volta para o usuário padrão de segurança do Puppeteer
USER pptruser

# Inicia o robô com o nome CORRETO do seu arquivo
CMD ["node", "chatbot.js"]
