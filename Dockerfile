FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY scripts ./scripts
COPY data ./data

USER node
EXPOSE 3000
# exec: o node vira o processo principal e recebe o SIGTERM do `docker compose down`.
CMD ["sh", "-c", "node scripts/seed.js && exec node src/server.js"]
