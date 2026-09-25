FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
COPY apps/web apps/web
COPY services/render-tools/package.json services/render-tools/package.json
COPY packages/html-engine packages/html-engine
COPY third_party/calque/package.json third_party/calque/package.json
RUN npm install --no-audit --no-fund --legacy-peer-deps && npm run build -w apps/web
FROM nginx:1.27-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
