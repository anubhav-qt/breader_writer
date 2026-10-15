/*
 * Reading and writing KEY=value files, for the scripts that write the writer's settings from
 * breader's (dev-env.mjs and live-env.mjs). Neither prints a value it reads.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';

export function unquote(value) {
  const first = value[0];
  const last = value[value.length - 1];
  const quoted = first === '"' || first === "'";
  if (value.length >= 2 && quoted && first === last) return value.slice(1, -1);
  return value;
}

/**
 * KEY=value lines as an object, each value as it's written, quotes and all, for a file compose
 * reads (it takes the quotes off itself). Blank lines and comments are skipped.
 */
export function parseRaw(text) {
  const values = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const at = trimmed.indexOf('=');
    if (at < 0) continue;
    const key = trimmed.slice(0, at).trim();
    values[key] = trimmed.slice(at + 1).trim();
  }
  return values;
}

/** KEY=value lines as an object, without the quotes around a value. */
export function parse(text) {
  const values = parseRaw(text);
  for (const key of Object.keys(values)) {
    values[key] = unquote(values[key]);
  }
  return values;
}

/** A file's lines, without the newline at its end. */
export function readLines(path) {
  return readFileSync(path, 'utf8').replace(/\n$/, '').split('\n');
}

/** Sets KEY=value where the key already is, or adds it at the end. */
export function setLine(lines, key, value) {
  const at = lines.findIndex((line) => line.startsWith(`${key}=`));
  if (at >= 0) {
    lines[at] = `${key}=${value}`;
  } else {
    lines.push(`${key}=${value}`);
  }
}

/** Writes the lines readable by their owner alone, since they hold secrets. */
export function writeSecret(path, lines) {
  writeFileSync(path, `${lines.join('\n')}\n`, { mode: 0o600 });
  // The mode above only applies to a new file.
  chmodSync(path, 0o600);
}

/**
 * Makes a random secret for the key unless the lines hold one already, since changing it would
 * lose what it guards. Answers whether it made one.
 */
export function keepOrMakeSecret(lines, key) {
  const current = parse(lines.join('\n'))[key];
  if (current) return false;
  setLine(lines, key, randomBytes(32).toString('base64url'));
  return true;
}
