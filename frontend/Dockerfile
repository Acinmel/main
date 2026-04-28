# syntax=docker/dockerfile:1
# 构建静态站点 + Nginx，同域反代 /api → 后端（线上用户只访问一个站点）
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
ARG USE_CN_MIRROR=1
RUN if [ "$USE_CN_MIRROR" = "1" ]; then npm config set registry https://registry.npmmirror.com; fi \
  && npm ci
COPY . .
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginx:alpine
COPY deploy/nginx-web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
