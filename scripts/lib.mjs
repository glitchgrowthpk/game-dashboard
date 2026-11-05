// Shared helpers for the daily scripts.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = join(ROOT, 'public', 'data');

export function readJson(path, fallback = undefined) {
  if (!existsSync(path)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing file: ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

export function loadGames() {
  return readJson(join(ROOT, 'games.json'));
}

/** YYYY-MM-DD for `daysAgo` days before today (UTC). */
export function isoDay(daysAgo = 0, from = new Date()) {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

/** GA4 dates come back as YYYYMMDD. */
export function gaDateToIso(s) {
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/**
 * Reads the service-account key from GA_SA_KEY. Accepts raw JSON or base64-encoded JSON,
 * so it can be pasted into GitHub Secrets either way.
 */
export function serviceAccountFromEnv() {
  // Locally, a key file is easier: GA_SA_KEY_FILE=<path>, or service-account.json in the project root.
  let raw = process.env.GA_SA_KEY;
  const file = process.env.GA_SA_KEY_FILE || join(ROOT, 'service-account.json');
  if (!raw && existsSync(file)) raw = readFileSync(file, 'utf8');
  if (!raw) {
    throw new Error(
      'No service-account key. Set GA_SA_KEY (JSON or base64), set GA_SA_KEY_FILE to the key file, or save it as service-account.json.'
    );
  }
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const key = JSON.parse(text);
  if (!key.client_email || !key.private_key) {
    throw new Error('GA_SA_KEY does not look like a service-account key (no client_email/private_key).');
  }
  return key;
}
