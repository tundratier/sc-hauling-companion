FROM node:24.22.1-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS dev
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM deps AS check
COPY . .
RUN npm run lint && npm run typecheck && npm run test -- --run

FROM deps AS build
COPY . .
# URL prefix the app is served under, e.g. /sc-hauling-companion/ on GitHub Pages
ARG BASE_PATH=/
RUN npm run build

# Static files only: docker build --target dist --output type=local,dest=dist .
FROM scratch AS dist
COPY --from=build /app/dist /

FROM nginxinc/nginx-unprivileged:1.30-alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
