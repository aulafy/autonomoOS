FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY pymes/package.json pymes/package.json
RUN npm ci
COPY pymes pymes
ENV NODE_ENV=production PYMES_API_HOST=0.0.0.0 PYMES_API_PORT=8790 PYMES_API_DB_PATH=/data/pymes-workspace.db
EXPOSE 8790
VOLUME ["/data"]
CMD ["node", "--import", "tsx", "pymes/src/server.ts"]
