# 1단계: 빌드 (Node 20, .nvmrc와 같은 메이저 버전)
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci
COPY . .

# VITE_ 변수는 빌드 결과에 박힌다. 기본은 실제 백엔드 연결(API 모드)
ARG VITE_USE_API=true
ARG VITE_USE_LIVE_V1=false
ARG VITE_API_BASE_URL=
ENV VITE_USE_API=$VITE_USE_API VITE_API_BASE_URL=$VITE_API_BASE_URL VITE_USE_LIVE_V1=$VITE_USE_LIVE_V1
RUN npm run build

# 2단계: 실행 (비루트 nginx, 컨테이너 안 포트 8080)
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

# /api를 넘길 백엔드 주소. docker run -e BACKEND_URL=... 로 바꿀 수 있다
ENV BACKEND_URL=http://host.docker.internal:8080
EXPOSE 8080
