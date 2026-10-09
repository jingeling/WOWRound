// HTTP-server: pagina's, een kleine JSON-API voor de eigenaar en de WebSocket-signalering.
// Geen framework, alleen de Node-standaardbibliotheek plus 'ws' (principe 17 en 18).

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RateLimiter,
  SessionStore,
  parseCookies,
  sessionCookie,
  sessionCookieName,
  verifyPassword,
} from './auth.js';
import { RoomStore, isRoomId } from './rooms.js';
import { clientIp, sameOrigin, securityHeaders } from './security.js';
import { createSignaling } from './signaling.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

export function createApp(config, { log = console } = {}) {
  const sessions = new SessionStore(config.sessionTtlMs);
  const rooms = new RoomStore({ dataDir: config.dataDir, secret: config.appSecret });
  const loginLimiter = new RateLimiter({ limit: 5, windowMs: 15 * 60_000 });
  const guestLimiter = new RateLimiter({ limit: 30, windowMs: 60_000 });
  const headers = securityHeaders(config);
  const cookieName = sessionCookieName(config.secureCookies);

  const ipOf = (req) => clientIp(req, config.trustProxy);
  const sessionId = (req) => parseCookies(req.headers.cookie)[cookieName];
  const isOwnerRequest = (req) => sessions.isValid(sessionId(req));

  function respond(res, status, body, extraHeaders = {}) {
    const isJson = body !== null && typeof body === 'object' && !Buffer.isBuffer(body);
    const payload = isJson ? JSON.stringify(body) : body;
    res.writeHead(status, {
      ...headers,
      'Cache-Control': 'no-store',
      ...(isJson ? { 'Content-Type': 'application/json; charset=utf-8' } : {}),
      ...extraHeaders,
    });
    res.end(payload);
  }

  function redirect(res, location) {
    respond(res, 303, '', { Location: location });
  }

  function serveFile(res, relPath, cache = 'no-cache') {
    const filePath = path.resolve(PUBLIC_DIR, relPath);
    if (!filePath.startsWith(PUBLIC_DIR + path.sep)) return respond(res, 404, 'Niet gevonden');
    fs.readFile(filePath, (err, data) => {
      if (err) return respond(res, 404, 'Niet gevonden', { 'Content-Type': 'text/plain; charset=utf-8' });
      const type = MIME[path.extname(filePath)] || 'application/octet-stream';
      respond(res, 200, data, { 'Content-Type': type, 'Cache-Control': cache });
    });
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      if (!(req.headers['content-type'] || '').startsWith('application/json')) {
        return reject(Object.assign(new Error('JSON verwacht'), { status: 415 }));
      }
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > 4096) {
          reject(Object.assign(new Error('Te groot'), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
        } catch {
          reject(Object.assign(new Error('Ongeldige JSON'), { status: 400 }));
        }
      });
      req.on('error', reject);
    });
  }

  function roomView(room) {
    return {
      id: room.id,
      name: room.name,
      createdAt: room.createdAt,
      // De sleutel staat achter het #: browsers sturen dat deel nooit naar de server,
      // dus het komt ook niet in logs van proxies terecht.
      guestUrl: `${config.origin}/r/${room.id}#k=${rooms.guestKey(room)}`,
      ownerUrl: `${config.origin}/r/${room.id}`,
    };
  }

  let signaling;

  async function handleApi(req, res, url) {
    const method = req.method;

    // Alles wat iets verandert moet van onze eigen pagina komen.
    if (method !== 'GET' && !sameOrigin(req, config)) return respond(res, 403, { error: 'origin' });

    if (url.pathname === '/api/login' && method === 'POST') {
      const ip = ipOf(req);
      if (!loginLimiter.take(ip)) {
        log.warn(`Inlogpoging geblokkeerd (te veel pogingen) vanaf ${ip}`);
        return respond(res, 429, { error: 'Te veel pogingen. Probeer het over een kwartier opnieuw.' });
      }
      const body = await readJson(req);
      if (!verifyPassword(body.password, config.ownerPasswordHash)) {
        log.warn(`Mislukte inlogpoging vanaf ${ip}`);
        return respond(res, 401, { error: 'Onjuist wachtwoord.' });
      }
      loginLimiter.reset(ip);
      const id = sessions.create();
      return respond(res, 200, { ok: true }, {
        'Set-Cookie': sessionCookie(cookieName, id, {
          secure: config.secureCookies,
          maxAgeSeconds: Math.floor(config.sessionTtlMs / 1000),
        }),
      });
    }

    if (url.pathname === '/api/logout' && method === 'POST') {
      sessions.destroy(sessionId(req));
      return respond(res, 200, { ok: true }, {
        'Set-Cookie': sessionCookie(cookieName, '', { secure: config.secureCookies, maxAgeSeconds: 0 }),
      });
    }

    if (url.pathname === '/api/me' && method === 'GET') {
      return respond(res, 200, { owner: isOwnerRequest(req) });
    }

    // Alles hieronder is alleen voor de eigenaar.
    if (!isOwnerRequest(req)) return respond(res, 401, { error: 'Niet ingelogd.' });

    if (url.pathname === '/api/logout-all' && method === 'POST') {
      sessions.clear();
      log.warn('Overal uitgelogd op verzoek van de eigenaar');
      return respond(res, 200, { ok: true }, {
        'Set-Cookie': sessionCookie(cookieName, '', { secure: config.secureCookies, maxAgeSeconds: 0 }),
      });
    }

    if (url.pathname === '/api/rooms') {
      if (method === 'GET') return respond(res, 200, { rooms: rooms.list().map(roomView) });
      if (method === 'POST') {
        const body = await readJson(req);
        return respond(res, 201, { room: roomView(rooms.create(body.name)) });
      }
    }

    const match = url.pathname.match(/^\/api\/rooms\/([^/]+)(\/rotate)?$/);
    if (match && isRoomId(match[1])) {
      const [, id, rotate] = match;
      if (rotate && method === 'POST') {
        const room = rooms.rotateKey(id);
        if (!room) return respond(res, 404, { error: 'Ruimte niet gevonden.' });
        signaling.evictGuests(id);
        return respond(res, 200, { room: roomView(room) });
      }
      if (!rotate && method === 'PATCH') {
        const body = await readJson(req);
        const room = rooms.rename(id, body.name);
        return room ? respond(res, 200, { room: roomView(room) }) : respond(res, 404, { error: 'Ruimte niet gevonden.' });
      }
      if (!rotate && method === 'DELETE') {
        if (!rooms.remove(id)) return respond(res, 404, { error: 'Ruimte niet gevonden.' });
        signaling.evictRoom(id);
        return respond(res, 200, { ok: true });
      }
    }

    return respond(res, 404, { error: 'Niet gevonden.' });
  }

  async function handle(req, res) {
    const url = new URL(req.url, config.origin);
    const p = url.pathname;

    if (p.startsWith('/api/')) return handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return respond(res, 405, 'Methode niet toegestaan');

    if (p === '/healthz') return respond(res, 200, 'ok', { 'Content-Type': 'text/plain' });
    if (p === '/') return isOwnerRequest(req) ? serveFile(res, 'index.html') : redirect(res, '/login');
    if (p === '/login') return isOwnerRequest(req) ? redirect(res, '/') : serveFile(res, 'login.html');
    if (/^\/r\/[^/]+$/.test(p)) return serveFile(res, 'room.html');
    if (p.startsWith('/assets/')) return serveFile(res, p.slice(1), 'public, max-age=300');
    if (p === '/favicon.svg') return serveFile(res, 'assets/favicon.svg', 'public, max-age=86400');

    return respond(res, 404, 'Niet gevonden', { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      const status = err.status || 500;
      if (status === 500) log.error(err);
      if (!res.headersSent) respond(res, status, { error: status === 500 ? 'Er ging iets mis.' : err.message });
    });
  });

  // Trage of hangende verbindingen niet eindeloos openhouden.
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;

  signaling = createSignaling({ server, config, rooms, isOwnerRequest, ipOf, guestLimiter });

  return {
    server,
    rooms,
    close() {
      signaling.close();
      sessions.close();
      loginLimiter.close();
      guestLimiter.close();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}
