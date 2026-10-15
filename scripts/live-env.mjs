/*
 * Writes infra/.env, the writer's settings on the laptop (infra/compose.yml), from breader's own
 * infra/.env: its database (the transaction pooler for the API, the session pooler for the
 * migrations and the backup), the secret its login cookie is signed with, its backup key and R2
 * bucket, and the keys of the AI accounts' proxy its worker runs, made from its ADMIN_TOKEN the way
 * breader makes them. Everything else stays as infra/.env has it, or as infra/.env.example has it
 * the first time. Nothing read is printed.
 *
 *   npm run live:env                       breader's settings from ../breader/infra/.env
 *   BREADER_ENV=<path> npm run live:env    from somewhere else
 */
import { hkdfSync } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, parseRaw, readLines, setLine, writeSecret } from './env-file.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const breaderEnv = process.env.BREADER_ENV || resolve(root, '../breader/infra/.env');
const target = resolve(root, 'infra/.env');
const example = resolve(root, 'infra/.env.example');

/** Each writer setting, and the breader setting it's copied from. The writer can't run without these. */
const NEEDED = {
  DATABASE_URL: 'PRIMARY_URL',
  SESSION_DATABASE_URL: 'PRIMARY_SESSION_URL',
  SESSION_SECRET: 'SESSION_SECRET',
};

/** Copied when breader has them. Without the backup's, there's no backup. */
const WANTED = {
  DATABASE_SSL: 'PRIMARY_SSL',
  COOKIE_SECURE: 'COOKIE_SECURE',
  BACKUP_RECIPIENT: 'BACKUP_RECIPIENT',
  S3_ENDPOINT: 'S3_ENDPOINT',
  S3_ACCESS_KEY_ID: 'S3_ACCESS_KEY_ID',
  S3_SECRET_ACCESS_KEY: 'S3_SECRET_ACCESS_KEY',
  S3_BACKUP_BUCKET: 'S3_BACKUP_BUCKET',
};

/** One of the proxy's keys, as breader's server/src/lib/cliproxy.ts makes it. */
function proxyKey(adminToken, what) {
  const key = hkdfSync('sha256', adminToken, 'breader', `cliproxy ${what}`, 24);
  return Buffer.from(key).toString('hex');
}

if (!existsSync(breaderEnv)) {
  console.error(`Breader's settings aren't at ${breaderEnv}. Set BREADER_ENV to where they are.`);
  process.exit(1);
}
const breaderText = readFileSync(breaderEnv, 'utf8');
const breader = parse(breaderText);
// Copied as breader writes them, since compose reads both files the same way.
const asWritten = parseRaw(breaderText);
const missing = [];
for (const from of Object.values(NEEDED)) {
  if (!breader[from]) missing.push(from);
}
if (!breader.ADMIN_TOKEN) missing.push('ADMIN_TOKEN');
if (missing.length > 0) {
  console.error(`Breader's settings have no ${missing.join(', ')}.`);
  process.exit(1);
}

let start = example;
if (existsSync(target)) start = target;
const lines = readLines(start);
const copied = [];
const notThere = [];
for (const [key, from] of Object.entries({ ...NEEDED, ...WANTED })) {
  if (breader[from]) {
    setLine(lines, key, asWritten[from]);
    copied.push(from);
  } else {
    notThere.push(from);
  }
}
setLine(lines, 'CLIPROXY_API_KEY', proxyKey(breader.ADMIN_TOKEN, 'api key'));
setLine(lines, 'CLIPROXY_MANAGEMENT_KEY', proxyKey(breader.ADMIN_TOKEN, 'management key'));
writeSecret(target, lines);

console.log(`Wrote infra/.env with breader's ${copied.join(', ')} (values not shown).`);
console.log("And the proxy's two keys, made from breader's ADMIN_TOKEN (not shown).");
if (notThere.length > 0) {
  console.log(`Breader has no ${notThere.join(', ')}, so infra/.env keeps what it had for them.`);
}
const written = parse(lines.join('\n'));
if (!written.WRITER_EMAILS) {
  console.log('WRITER_EMAILS is empty: add the emails that may write, or everyone sees "invite only".');
}
if (!written.OWNER_EMAILS) {
  console.log('OWNER_EMAILS is empty: add the owner\'s email, or nobody can sign the AI accounts in and out.');
}
