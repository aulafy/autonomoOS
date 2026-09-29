FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY pymes/package.json pymes/package.json
RUN npm ci
COPY pymes pymes
RUN mkdir -p /data && chown -R node:node /app /data
ENV NODE_ENV=production PYMES_API_HOST=0.0.0.0 PYMES_API_PORT=8790 PYMES_API_DB_PATH=/data/pymes-workspace.db
USER node
EXPOSE 8790
VOLUME ["/data"]
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:8790/readyz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "--import", "tsx", "pymes/src/server.ts"]
