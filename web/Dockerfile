# La página de Magister Studio: se construye con Node 22 y la sirve Caddy.
FROM node:22-alpine AS construir
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM caddy:2.10-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=construir /web/dist /srv
