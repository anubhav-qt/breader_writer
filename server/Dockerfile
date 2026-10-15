# The writer's server (build context: the repository root). One image, three commands:
#   node --import tsx src/api.ts       the API (default)
#   node --import tsx src/migrate.ts   the writer schema's migrations (the compose migrate service)
#   sh /app/infra/backup.sh            the nightly backup (the compose backup service)
# The server runs from its TypeScript sources through tsx, as it does locally, so there's no build
# step: the prompts' templates and the migrations are read from beside the code.

# The writers' proxy, CLIProxyAPI (src/ai/own/writers_proxy.ts): its static build, for the image's
# platform, checked against the checksums its release lists. The same release as breader's.
FROM --platform=$BUILDPLATFORM node:24-alpine AS cliproxy
ARG TARGETARCH
ARG CLIPROXY=8.0.5
WORKDIR /cliproxy
RUN arch=amd64 && sum=1424923a52a62e3db3b6871e5f97b046da6d000ba071b1c2fe28013668d7b54b \
  && if [ "$TARGETARCH" = arm64 ]; then arch=aarch64 && sum=3b255caee58136dff328be9a1e307f4d887b1bce5da5549951e7d8ebf3017ce2; fi \
  && file="CLIProxyAPI_${CLIPROXY}_linux_${arch}_no-plugin.tar.gz" \
  && wget -q "https://github.com/router-for-me/CLIProxyAPI/releases/download/v${CLIPROXY}/$file" \
  && echo "$sum  $file" | sha256sum -c - \
  && tar -xzf "$file" cli-proxy-api

FROM node:24-alpine
# pg_dump for the backup (at least Supabase's major version), age to encrypt it to the backup key,
# rclone to send it to R2, tini to forward signals, and tzdata so the backup's hour is local.
RUN apk add --no-cache postgresql17-client age rclone tini tzdata \
  && mkdir -p /data/backups /data/writers-proxy && chown node:node /data/backups /data/writers-proxy
COPY --from=cliproxy /cliproxy/cli-proxy-api /usr/local/bin/cli-proxy-api
WORKDIR /app
ENV NODE_ENV=production
# The packages first, so a change to the code alone reuses them. The frontend's manifest is only
# there because the lockfile names it.
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/
COPY shared/package.json shared/
COPY server/package.json server/
COPY packages/pi-ai/package.json packages/pi-ai/
COPY packages/pi-agent/package.json packages/pi-agent/
RUN npm ci --omit=dev --workspace server --workspace shared --workspace packages/pi-ai --workspace packages/pi-agent --no-audit --no-fund \
  && npm cache clean --force
COPY shared shared
COPY packages packages
COPY server/tsconfig.json server/
COPY server/drizzle server/drizzle
COPY server/src server/src
COPY infra/backup.sh infra/
# The commit, shown by /health, so you can see which version runs.
ARG RELEASE=dev
ENV RELEASE=$RELEASE
WORKDIR /app/server
USER node
EXPOSE 8790
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--import", "tsx", "src/api.ts"]
