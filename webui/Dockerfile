FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js auth.js ./
# /data holds shares.json; node-owned so the share CLI can write it.
# A fresh named volume inherits this ownership on first mount.
RUN mkdir -p /data && chown node:node /data
ENV PORT=8080 GAMES_DIR=/srv/games SHARES_FILE=/data/shares.json
EXPOSE 8080
USER node
CMD ["node", "server.js"]
