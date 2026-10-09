// Alle configuratie op één plek (principe 18: onderhoudbaar voor één persoon).
// Ontbrekende of zwakke geheimen laten de server bewust niet starten.

import path from 'node:path';

const env = process.env;

function required(name) {
  const value = env[name];
  if (!value || !value.trim()) {
    throw new Error(`Ontbrekende instelling: ${name}. Zie .env.example.`);
  }
  return value.trim();
}

function list(name, fallback = []) {
  const value = env[name];
  if (value === undefined) return fallback;
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig() {
  const isDev = env.NODE_ENV === 'development';
  const publicUrl = new URL(env.PUBLIC_URL || 'http://localhost:3000');

  const appSecret = required('APP_SECRET');
  if (appSecret.length < 32) {
    throw new Error('APP_SECRET moet minstens 32 tekens zijn. Maak er een met: npm run gen-secret');
  }

  const ownerPasswordHash = required('OWNER_PASSWORD_HASH');
  if (!ownerPasswordHash.startsWith('scrypt$')) {
    throw new Error('OWNER_PASSWORD_HASH heeft een onbekend formaat. Maak er een met: npm run hash-password');
  }

  if (!isDev && publicUrl.protocol !== 'https:') {
    throw new Error('PUBLIC_URL moet met https:// beginnen buiten ontwikkelmodus (NODE_ENV=development).');
  }

  const turnSecret = env.TURN_SECRET?.trim() || null;
  const turnUrls = list('TURN_URLS');
  if (turnUrls.length && !turnSecret) {
    throw new Error('TURN_URLS is ingesteld maar TURN_SECRET ontbreekt.');
  }

  return Object.freeze({
    isDev,
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 3000),
    publicUrl,
    origin: publicUrl.origin,
    secureCookies: publicUrl.protocol === 'https:',
    trustProxy: env.TRUST_PROXY === 'true',
    appSecret,
    sessionTtlMs: Number(env.SESSION_TTL_HOURS || 168) * 3600_000,
    ownerPasswordHash,
    dataDir: path.resolve(env.DATA_DIR || './data'),
    stunUrls: list('STUN_URLS', ['stun:stun.nextcloud.com:443']),
    turnUrls,
    turnSecret,
    turnTtlSeconds: Number(env.TURN_TTL_SECONDS || 3600),
  });
}
