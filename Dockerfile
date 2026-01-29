# Começamos com um Linux leve e limpo com Node.js 18
FROM node:18-slim

# 1. Instala o Google Chrome Stable Oficial e as fontes necessárias
# (Isso garante que o arquivo /usr/bin/google-chrome-stable vai existir)
RUN apt-get update && apt-get install -y wget gnupg ca-certificates procps libxss1 \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/googlechrome-linux-keyring.gpg \
    && sh -c 'echo "deb [arch=amd64 signed-by=/usr/share/keyrings/googlechrome-linux-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 2. Dizemos para o código: "O Chrome está AQUI, use este e não baixe outro"
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Configura a pasta de trabalho
WORKDIR /app

# Copia e instala o projeto
COPY package*.json ./
RUN npm install

# Copia o código do robô
COPY . .

# Inicia o robô (usando o nome certo do arquivo)
CMD ["node", "chatbot.js"]
