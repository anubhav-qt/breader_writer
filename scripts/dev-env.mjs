/*
 * Writes server/.env for running the writer here against production breader. Breader's own
 * settings (its infra/.env) give the secret its login cookie is signed with and where its logins
 * are. The CLIProxyAPI that Homebrew runs here gives its address and its API key. Everything
 * else stays as server/.env has it, or as server/.env.example has it the first time. Nothing
 * read is printed.
 *
 *   npm run dev:env                        breader's settings from ../breader/infra/.env
 *   BREADER_ENV=<path> npm run dev:env     from somewhere else
 *   CLIPROXY_CONFIG=<path> npm run dev:env the proxy's config from somewhere else
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, readLines, setLine, unquote, writeSecret } from './env-file.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const breaderEnv = process.env.BREADER_ENV || resolve(root, '../breader/infra/.env');
const target = resolve(root, 'server/.env');
const example = resolve(root, 'server/.env.example');
const proxyConfig = process.env.CLIPROXY_CONFIG || '/opt/homebrew/etc/cliproxyapi.conf';

/** Each writer setting, and the breader setting it's copied from. */
const FROM_BREADER = {
  SESSION_SECRET: 'SESSION_SECRET',
  COOKIE_SECURE: 'COOKIE_SECURE',
  BREADER_DATABASE_URL: 'PRIMARY_URL',
  BREADER_DATABASE_SSL: 'PRIMARY_SSL',
};

/** A YAML value without its quotes or a comment after it. */
function yamlValue(raw) {
  const withoutComment = raw.replace(/\s+#.*$/, '').trim();
  return unquote(withoutComment);
}

/** The lines indented under a top-level YAML key, like `server:`. */
function section(lines, name) {
  const start = lines.findIndex((line) => line === `${name}:`);
  if (start < 0) return [];
  const inside = [];
  for (const line of lines.slice(start + 1)) {
    const topLevel = line.length > 0 && !line.startsWith(' ') && !line.startsWith('#');
    if (topLevel) break;
    inside.push(line);
  }
  return inside;
}

/** The proxy's address and its first API key, from its config, or null if they aren't there. */
function readProxy(text) {
  const lines = text.split('\n');
  const server = section(lines, 'server');
  const portLine = server.find((line) => line.trim().startsWith('port:'));
  const access = section(lines, 'access');
  const keysAt = access.findIndex((line) => line.trim() === 'api-keys:');
  if (!portLine || keysAt < 0) return null;
  const keyLine = access.slice(keysAt + 1).find((line) => line.trim().startsWith('-'));
  if (!keyLine) return null;
  const port = yamlValue(portLine.trim().slice('port:'.length));
  const key = yamlValue(keyLine.trim().slice(1));
  return { url: `http://127.0.0.1:${port}`, key };
}

if (!existsSync(breaderEnv)) {
  console.error(`Breader's settings aren't at ${breaderEnv}. Set BREADER_ENV to where they are.`);
  process.exit(1);
}
const breader = parse(readFileSync(breaderEnv, 'utf8'));
const missing = Object.values(FROM_BREADER).filter((key) => !breader[key]);
if (missing.length > 0) {
  console.error(`Breader's settings have no ${missing.join(', ')}.`);
  process.exit(1);
}

let start = example;
if (existsSync(target)) start = target;
const lines = readLines(start);
for (const [key, from] of Object.entries(FROM_BREADER)) {
  setLine(lines, key, breader[from]);
}
let proxy = null;
if (existsSync(proxyConfig)) {
  proxy = readProxy(readFileSync(proxyConfig, 'utf8'));
}
if (proxy) {
  setLine(lines, 'CLIPROXY_URL', proxy.url);
  setLine(lines, 'CLIPROXY_API_KEY', proxy.key);
}
writeSecret(target, lines);

console.log(`Wrote server/.env with breader's ${Object.values(FROM_BREADER).join(', ')} (values not shown).`);
if (proxy) {
  console.log(`And the address and API key of the CLIProxyAPI in ${proxyConfig} (key not shown).`);
} else {
  console.log(`No CLIProxyAPI config at ${proxyConfig}, so the AI is offline. Set CLIPROXY_CONFIG to where it is.`);
}
const written = parse(lines.join('\n'));
if (proxy && !written.CLIPROXY_MANAGEMENT_KEY) {
  console.log('CLIPROXY_MANAGEMENT_KEY is empty: add the proxy\'s management key for the models\' thinking levels.');
}
const emails = written.WRITER_EMAILS;
if (!emails) {
  console.log('WRITER_EMAILS is empty: add the emails that may write, or everyone sees "invite only".');
}
