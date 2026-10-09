// Inloggen van de eigenaar, sessies en rate limiting.
// Saai is veilig (principe 17): scrypt uit de Node-standaardbibliotheek,
// willekeurige sessie-ID's in het geheugen, vergelijkingen in constante tijd.

import crypto from 'node:crypto';

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password.normalize('NFKC'), salt, SCRYPT.keylen, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export function verifyPassword(password, stored) {
  if (typeof password !== 'string' || password.length === 0 || password.length > 1024) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  if (expected.length < 32) return false;
  try {
    const actual = crypto.scryptSync(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: SCRYPT.maxmem,
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Sessies leven alleen in het geheugen: een herstart logt iedereen uit.
// Voor een tool met één eigenaar is dat een voordeel, geen nadeel.
export class SessionStore {
  constructor(ttlMs) {
    this.ttlMs = ttlMs;
    this.sessions = new Map();
    this.sweeper = setInterval(() => this.sweep(), 10 * 60_000).unref();
  }

  create() {
    const id = crypto.randomBytes(32).toString('base64url');
    this.sessions.set(id, { expiresAt: Date.now() + this.ttlMs });
    return id;
  }

  isValid(id) {
    if (typeof id !== 'string' || id.length !== 43) return false;
    const session = this.sessions.get(id);
    if (!session) return false;
    if (session.expiresAt < Date.now()) {
      this.sessions.delete(id);
      return false;
    }
    return true;
  }

  destroy(id) {
    this.sessions.delete(id);
  }

  sweep() {
    const now = Date.now();
    for (const [id, s] of this.sessions) if (s.expiresAt < now) this.sessions.delete(id);
  }

  close() {
    clearInterval(this.sweeper);
  }
}

// Eenvoudige rate limiter met een vast venster per sleutel (bijvoorbeeld IP-adres).
export class RateLimiter {
  constructor({ limit, windowMs }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map();
    this.sweeper = setInterval(() => this.sweep(), windowMs).unref();
  }

  // Geeft true als de actie is toegestaan.
  take(key) {
    const now = Date.now();
    let entry = this.hits.get(key);
    if (!entry || entry.resetAt < now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    return entry.count <= this.limit;
  }

  reset(key) {
    this.hits.delete(key);
  }

  sweep() {
    const now = Date.now();
    for (const [key, e] of this.hits) if (e.resetAt < now) this.hits.delete(key);
  }

  close() {
    clearInterval(this.sweeper);
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (key) out[key] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookieName(secure) {
  // Het __Host-voorvoegsel dwingt Secure, Path=/ en geen Domain af.
  return secure ? '__Host-wowround' : 'wowround';
}

export function sessionCookie(name, value, { secure, maxAgeSeconds }) {
  const attrs = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSeconds}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}
