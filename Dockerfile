# Começamos com um Linux leve e limpo com Node.js 18
FROM node:18-slim

# 1. Instala o Chrome Stable, fontes e o "dumb-init" (que evita travamentos do robô)
RUN apt-get update && apt-get install -y wget gnupg ca-certificates procps libxss1 dumb-init \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/googlechrome-linux-keyring.gpg \
    && sh -c 'echo "deb [arch=amd64 signed-by=/usr/share/keyrings/googlechrome-linux-keyring.gpg] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 2. Configura onde o Chrome está
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# 3. Cria um usuário de segurança (pptruser) para NÃO rodar como Root
# O Chrome trava se rodar como root, por isso criamos este usuário.
RUN groupadd -r pptruser && useradd -r -g pptruser -G audio,video pptruser \
    && mkdir -p /home/pptruser/Downloads \
    && chown -R pptruser:pptruser /home/pptruser \
    && mkdir -p /app \
    && chown -R pptruser:pptruser /app

# Configura a pasta de trabalho
WORKDIR /app

# Copia os arquivos (como root para garantir permissão de escrita inicial)
COPY package*.json ./
RUN npm install

# Copia o código do robô
COPY . .

# Passa a posse da pasta para o usuário de segurança
RUN chown -R pptruser:pptruser /app

# 4. Troca para o usuário seguro antes de ligar
USER pptruser

# 5. Usa o dumb-init para iniciar (impede o erro "Recipiente de Parada")
ENTRYPOINT ["/usr/bin/dumb-init", "--"]

# Inicia o robô (usando o nome chatbot.js que você confirmou)
CMD ["node", "chatbot.js"]
