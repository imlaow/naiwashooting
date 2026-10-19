# syntax=docker/dockerfile:1
# The naiwa-server image (ghcr.io/imlaow/naiwa-server). Built from the repo root:
#
#   docker buildx build -f server/Dockerfile --platform linux/arm64,linux/amd64 -t ghcr.io/imlaow/naiwa-server:<version> .
#
# It runs what `npx naiwa-server` runs: the package is made the same way (tools/pack-server.mjs)
# and installed from its tarball. The config is /data/server.json (created from the example on a
# first run) with bans.json next to it, so mount a volume there. Every RUN is on the build
# machine's own platform, since the packages are plain JS, so the other platform needs no emulator.
ARG NODE=24-alpine

FROM --platform=$BUILDPLATFORM node:${NODE} AS build
WORKDIR /repo
COPY . .
RUN node tools/pack-server.mjs \
 && mkdir -p /app /data \
 && npm install --prefix /app --omit=dev --no-audit --no-fund ./build/naiwa-server-*.tgz

FROM node:${NODE}
LABEL org.opencontainers.image.title="naiwa-server" \
      org.opencontainers.image.description="Self-hosted co-op and PvP server for 奶蛙射击 (Naiwa Shootout)" \
      org.opencontainers.image.url="https://naiwashootout.laow.dev" \
      org.opencontainers.image.licenses="Apache-2.0"
ENV NODE_ENV=production
COPY --from=build /app /app
COPY --from=build --chown=node:node /data /data
USER node
WORKDIR /data
VOLUME /data
EXPOSE 7777
ENTRYPOINT ["node", "/app/node_modules/naiwa-server/server/cli.js"]
