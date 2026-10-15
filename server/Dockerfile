# The writer's server (build context: the repository root). One image, three commands:
#   node --import tsx src/api.ts       the API (default)
#   node --import tsx src/migrate.ts   the writer schema's migrations (the compose migrate service)
#   sh /app/infra/backup.sh            the nightly backup (the compose backup service)
# The server runs from its TypeScript sources through tsx, as it does locally, so there's no build
# step: the prompts' templates and the migrations are read from beside the code.
FROM node:24-alpine
# pg_dump for the backup (at least Supabase's major version), age to encrypt it to the backup key,
# rclone to send it to R2, tini to forward signals, and tzdata so the backup's hour is local.
RUN apk add --no-cache postgresql17-client age rclone tini tzdata \
  && mkdir -p /data/backups && chown node:node /data/backups
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
