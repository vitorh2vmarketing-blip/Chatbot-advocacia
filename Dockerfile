FROM node:18FROM node:18

# Instala o Google Chrome Stable.
# Ao instalar o navegador real, ele puxa automaticamente todas as bibliotecas de sistema.
RUN apt-get update && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/googlechrome-linux-keyring.gpg \
    && sh -c 'echo "deb [arch=amd64 signed-by=/usr/share/keyrings/googlechrome-linux-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# OTIMIZAÇÃO: Diz para o Puppeteer NÃO baixar o Chromium (usa o Chrome instalado acima)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Configura a pasta do robô
WORKDIR /app

# Copia os arquivos e instala o bot
COPY package*.json ./
RUN npm install

COPY . .

# Comando para iniciar
CMD ["node", "index.js"]
