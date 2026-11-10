# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
COPY frontend/package.json ./frontend/
RUN npm ci --workspace frontend

COPY frontend ./frontend
RUN npm run build --workspace frontend

# ---- Serve stage ----
FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
