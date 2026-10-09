ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-cjk fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN npm install --global npm@11.19.0 --no-audit --no-fund
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
COPY services/render-tools/package.json services/render-tools/package.json
COPY packages/html-engine packages/html-engine
COPY third_party/calque third_party/calque
RUN npm ci --no-audit --no-fund --legacy-peer-deps && npm run build -w third_party/calque
COPY services/render-tools services/render-tools
ENV CHROME_PATH=/usr/bin/chromium CONTAINER=true
EXPOSE 8012
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8012/health',{headers:{'x-tool-secret':process.env.TOOL_SECRET}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "services/render-tools/src/server.js"]
