FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
ENV PORT=8080 GAMES_DIR=/srv/games
EXPOSE 8080
USER node
CMD ["node", "server.js"]
