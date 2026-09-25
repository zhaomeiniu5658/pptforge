FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-cjk fonts-liberation && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY apps/web/package.json apps/web/package.json
COPY services/render-tools/package.json services/render-tools/package.json
COPY packages/html-engine packages/html-engine
COPY third_party/calque third_party/calque
RUN npm install --no-audit --no-fund --legacy-peer-deps && npm run build -w third_party/calque
COPY services/render-tools services/render-tools
CMD ["node", "services/render-tools/src/server.js"]
