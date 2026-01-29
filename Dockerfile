# Usa a imagem oficial do Puppeteer (já vem com Chrome e Node prontos)
# Essa é a estratégia mais segura para evitar erros de "Build" no Railway
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

# Define a variável de ambiente para garantir que o robô ache o Chrome da imagem
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Volta para o usuário padrão de segurança do Puppeteer
USER pptruser

# Inicia o robô
CMD ["node", "chatbot.js"]

