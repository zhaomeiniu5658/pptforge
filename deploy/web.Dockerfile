ARG NODE_IMAGE=node:22-bookworm-slim
ARG NGINX_IMAGE=nginx:1.27-alpine
FROM ${NODE_IMAGE} AS build
WORKDIR /app
RUN npm install --global npm@11.19.0 --no-audit --no-fund
COPY package*.json ./
COPY apps/web apps/web
COPY services/render-tools/package.json services/render-tools/package.json
COPY packages/html-engine packages/html-engine
COPY third_party/calque/package.json third_party/calque/package.json
RUN npm ci --no-audit --no-fund --legacy-peer-deps && npm run build -w apps/web
FROM ${NGINX_IMAGE}
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
