# Running the writer

The writer lives beside breader and leans on it: breader's logins, its Supabase database, the AI
accounts' proxy its worker runs, its tunnel and its backup bucket. Of its own it has an API on the
laptop, the app as static files behind a Cloudflare Worker, and a nightly backup of its tables.

| Address | Goes to | Runs |
| --- | --- | --- |
| `breader.site/writer` | a Cloudflare Worker on that route, in front of breader's Pages site | the app (`frontend/worker.js` and the build) |
| `writer-api.breader.site` | breader's Cloudflare Tunnel → the laptop | `writer-api`, plus `migrate` and `backup` |
| (none) | breader's Supabase | the `writer` schema, beside breader's tables |
| (none) | breader's R2 backup bucket | the backups, under `writer/` |
| (none) | breader's worker, `worker:8327` | CLIProxyAPI, the AI accounts |
| (none) | inside `writer-api`, `127.0.0.1:8328` | the writers' proxy: a CLIProxyAPI of its own for writers' sign-ins, kept in the `writers-proxy` volume |

The app calls `writer-api.` with breader's login cookie, which is on `breader.site` and its
subdomains. While the laptop is off, the app says the writer is offline and comes back by itself.
The AI accounts are breader's too: the writer and breader's AI marker draw on the same limits.

Local development is in `CLAUDE.md`, "Running it locally".

## Setting up production

Do these in order, once breader's own stack runs on the laptop.

### 1. R2

`breader-backups` › Settings › Object lifecycle rules: add two more, delete prefix `writer/daily/`
after 7 days and prefix `writer/weekly/` after 28 days. Breader's own rules are on `daily/` and
`weekly/`, which don't reach under `writer/`. Breader's laptop token already writes to the bucket.

### 2. GitHub

1. Push to `dev`. CI builds `ghcr.io/anubhav-qt/breader-writer`.
2. Your profile › Packages › breader-writer › Package settings: make it **public**, so the laptop
   pulls without credentials. It holds code only, no settings and no books.

### 3. The API's address

Cloudflare Zero Trust › Networks › Tunnels › breader's tunnel › Public Hostname › add
`writer-api` · `breader.site` → service **HTTP**, URL **`writer-api:8790`**. Breader's tunnel
reaches it because the writer's API joins breader's compose network.

### 4. The laptop

1. Clone this repository beside breader's (`git clone … breader_writer`, next to `breader`).
2. Write `infra/.env` from breader's own: `npm run live:env`. It copies breader's database
   addresses, `SESSION_SECRET`, backup key and R2 settings, and makes the proxy's keys from
   breader's `ADMIN_TOKEN`, without printing any of them. Without Node on the laptop:
   ```sh
   docker run --rm -u "$(id -u)" -v "$(dirname "$PWD"):/w" -w "/w/$(basename "$PWD")" \
     node:24-alpine node scripts/live-env.mjs
   ```
   `BREADER_ENV=<path>` points it at breader's `infra/.env` if that isn't at `../breader/infra/.env`.
   The first time, it also makes `KEYS_SECRET`, which seals writers' own API keys, and keeps it
   every time after. Copy it somewhere safe (your password manager): the backups hold the keys
   only sealed, so a restore without it loses every writer's key, and they have to add them again.
3. In `infra/.env`, fill in `WRITER_EMAILS` (who can write) and `OWNER_EMAILS` (who signs the AI
   accounts in and out; each in `WRITER_EMAILS` too). Leave `OPEN_TO_ALL=false` for now (see
   "Opening it to everyone").
4. Start it:
   ```sh
   docker compose -f infra/compose.yml up -d
   docker compose -f infra/compose.yml logs -f writer-api   # "writer api listening"
   infra/update.sh --install                                # pull new releases every 5 minutes
   ```
   `migrate` runs first and exits; `writer-api` starts once it has. Breader's stack has to be up
   first, since the API joins its network.
5. `curl https://writer-api.breader.site/health` shows `{"ok":true,"release":"<commit>"}`.

### 5. The app

Cloudflare › Workers & Pages › Create › Import a repository › `breader_writer`:

- Project name `breader-writer` (the `name` in `frontend/wrangler.jsonc`), production branch `dev`.
- Root directory: the repository's root.
- Build command: `npm ci && npm run build -w frontend`
- Deploy command: `npx wrangler@4 deploy -c frontend/wrangler.jsonc`
- Build variables: `VITE_API_URL=https://writer-api.breader.site` and `NODE_VERSION=24`.
- Builds for non-production branches: off.

The deploy adds the routes `breader.site/writer` and `breader.site/writer/*` itself; the rest of
`breader.site` stays breader's Pages site. Check both:

```sh
curl -s https://breader.site/writer/books/x | grep -o '<title>[^<]*'   # the writer's title
curl -sI https://breader.site/writer | grep -i location                # .../writer/
curl -sI https://breader.site/ | head -1                               # breader, as before
```

If `/writer/` shows breader's own app, the route isn't running in front of Pages. Then the way in is
a Pages Function in breader (`functions/writer/[[path]].js`) that hands `/writer/*` to this Worker.

### 6. Try it

Log in on breader.site, then open `breader.site/writer`. The model chip lists the models; as the
owner, its menu lists the AI accounts, which breader's admin page signs in and out too. Make a
book and play a move. `docker compose -f infra/compose.yml logs writer-api | grep -i writers`
shows "the writers’ proxy started", beside the API.

## Opening it to everyone

Once it works for the invited, `OPEN_TO_ALL=true` in `infra/.env` (then
`docker compose -f infra/compose.yml up -d`) lets every breader account with a confirmed email
write. Their first chapter is on your AI accounts: setup help, scene 1 and its chapter. Going on
from scene 1 needs their own AI, which they bring in the model chip's menu under "Your AI": an API
key (Google, Anthropic or OpenAI), or a sign-in to a subscription they have (Antigravity, ChatGPT,
Claude). The invited keep your accounts for everything. Turning it back off shuts everyone else
out again; their books stay.

Writers' sign-ins go to the writers' proxy, never to breader's: `writer-api` runs it beside itself,
on its own machine only, and keeps them in the `writers-proxy` volume (not backed up: if it's lost,
writers sign in again). One writer signs in at a time; another trying meanwhile is told to wait a
minute or two.

The first time a writer signs in a subscription, check what couldn't be checked without a real
CLIProxyAPI:

1. Their picker lists the sign-in's models as "Your Antigravity sign-in" (or ChatGPT, Claude), and
   a move plays on one of them.
2. Another writer's picker doesn't list them.
3. `docker compose -f infra/compose.yml logs writer-api | grep -i "writers"` shows no complaint
   about its settings.

If 1 fails with a Gemini model only, the proxy's Gemini route doesn't take a model id with a slash
in it; if no sign-in models show at all, it doesn't list prefixed models. Either way, keys still
work, and the fix is in `server/src/ai/own/` (see "Notes for step 9" in `CLAUDE.md`).

## Backups

Every 10 minutes the `backup` service checks, and once a night after 03:00 (India) it dumps the
`writer` schema, encrypts it to breader's backup key, sends it to R2 under `writer/daily/` (and
`writer/weekly/` on Sundays) and keeps the newest 14 on the laptop. A backup that fails is tried
again at the next check.

```sh
docker compose -f infra/compose.yml logs backup                       # "backed up writer-DATE.dump.age"
docker compose -f infra/compose.yml exec backup sh /app/infra/backup.sh now   # one now
```

**Restore drill.** Every few months, on the machine with breader's backup key: download a backup
from R2 (`breader-backups` › `writer/daily/`), then restore it into a throwaway Postgres.

```sh
docker run -d --name restore-check -e POSTGRES_PASSWORD=check postgres:17-alpine
sleep 5
age -d -i breader-backup.agekey writer-DATE.dump.age \
  | docker exec -i restore-check pg_restore -U postgres --no-owner -d postgres
docker exec restore-check psql -U postgres -c 'select title, words_written from writer.books'
docker rm -f restore-check
```

**Restoring production.** Stop the API (`docker compose -f infra/compose.yml stop writer-api`),
then replace the `writer` schema from a backup, through the session pooler. It leaves breader's
tables alone.

```sh
age -d -i breader-backup.agekey writer-DATE.dump.age \
  | pg_restore --clean --if-exists --no-owner -d "<SESSION_DATABASE_URL>"
docker compose -f infra/compose.yml start writer-api
```

## Updating

A push to `dev` publishes a new image; `update.sh` pulls it within 5 minutes, `migrate` brings the
schema to it, and the API restarts on it. Workers Builds deploys the app from the same commit.

What the writer takes from breader's `infra/.env` changes with it: after breader's `SESSION_SECRET`,
`ADMIN_TOKEN`, database or backup settings change, run `npm run live:env` again and
`docker compose -f infra/compose.yml up -d`. If breader's stack was taken down (`down`, which
removes its network), bring the writer up again after it.
