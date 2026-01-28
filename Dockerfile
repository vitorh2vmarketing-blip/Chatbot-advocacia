FROM node:18

# Instala o Google Chrome Stable.
# Ao instalar o navegador real, ele puxa automaticamente todas as bibliotecas de sistema (glib, nss, etc)
# que o Puppeteer precisa, evitando erros de "pacote não encontrado".
RUN apt-get update && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/googlechrome-linux-keyring.gpg \
    && sh -c 'echo "deb [arch=amd64 signed-by=/usr/share/keyrings/googlechrome-linux-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Configura a pasta do robô
WORKDIR /app

# Copia os arquivos e instala o bot
COPY package*.json ./
RUN npm install

COPY . .

# Comando para iniciar
CMD ["node", "index.js"]
