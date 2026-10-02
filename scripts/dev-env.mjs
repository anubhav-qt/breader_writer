/*
 * Writes server/.env for running the writer here against production breader. Breader's own
 * settings (its infra/.env) give the secret its login cookie is signed with and where its logins
 * are. Everything else stays as server/.env has it, or as server/.env.example has it the first
 * time. Nothing read from breader is printed.
 *
 *   npm run dev:env                        breader's settings from ../breader/infra/.env
 *   BREADER_ENV=<path> npm run dev:env     from somewhere else
 */
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const breaderEnv = process.env.BREADER_ENV || resolve(root, '../breader/infra/.env');
const target = resolve(root, 'server/.env');
const example = resolve(root, 'server/.env.example');

/** Each writer setting, and the breader setting it's copied from. */
const FROM_BREADER = {
  SESSION_SECRET: 'SESSION_SECRET',
  COOKIE_SECURE: 'COOKIE_SECURE',
  BREADER_DATABASE_URL: 'PRIMARY_URL',
  BREADER_DATABASE_SSL: 'PRIMARY_SSL',
};

function unquote(value) {
  const first = value[0];
  const last = value[value.length - 1];
  const quoted = first === '"' || first === "'";
  if (value.length >= 2 && quoted && first === last) return value.slice(1, -1);
  return value;
}

/** KEY=value lines as an object. Blank lines and comments are skipped. */
function parse(text) {
  const values = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at < 0) continue;
    const key = trimmed.slice(0, at).trim();
    values[key] = unquote(trimmed.slice(at + 1).trim());
  }
  return values;
}

/** Sets KEY=value where the key already is, or adds it at the end. */
function setLine(lines, key, value) {
  const at = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (at >= 0) {
    lines[at] = `${key}=${value}`;
  } else {
    lines.push(`${key}=${value}`);
  }
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
const lines = readFileSync(start, 'utf8').replace(/\n$/, '').split('\n');
for (const [key, from] of Object.entries(FROM_BREADER)) {
  setLine(lines, key, breader[from]);
}
writeFileSync(target, `${lines.join('\n')}\n`, { mode: 0o600 });
// The mode above only applies to a new file.
chmodSync(target, 0o600);

console.log(`Wrote server/.env with breader's ${Object.values(FROM_BREADER).join(', ')} (values not shown).`);
const emails = parse(lines.join('\n')).WRITER_EMAILS;
if (!emails) {
  console.log('WRITER_EMAILS is empty: add the emails that may write, or everyone sees "invite only".');
}
