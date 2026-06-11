# Usa a versão Slim (baseada em Debian, mais amigável ao Prisma)
FROM node:22-slim

# Instala o OpenSSL exigido pelo Prisma
RUN apt-get update -y && apt-get install -y openssl

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/

RUN npm install

COPY . .

RUN npx prisma generate

EXPOSE 3001

CMD ["npm", "run", "dev"]