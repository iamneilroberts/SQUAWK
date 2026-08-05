# adsb-game frontend — two-stage build. Stage 1 builds the Vite/React/Cesium SPA;
# stage 2 serves the static output through nginx (see nginx.conf).
FROM node:22 AS build
WORKDIR /app

# Separate copy for layer caching: dependencies only reinstall when lockfiles change.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# `npm run build` runs `prebuild` (scripts/copy-cesium-assets.sh) first, which copies
# Cesium's static assets from node_modules into public/cesium/ — that dir is gitignored
# (G-004), so it must be generated here, not expected in the build context.
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
