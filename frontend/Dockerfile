# syntax=docker/dockerfile:1
# 前端：构建出静态文件，放进 Caddy 镜像。Caddy 同时负责 HTTPS 和把 /api 转给后端，
# 配置（Caddyfile）在部署目录里，挂载进来

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build

FROM caddy:2-alpine
COPY --from=build /app/dist /srv
