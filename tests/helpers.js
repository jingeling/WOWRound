import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { createApp } from '../server/app.js';
import { hashPassword } from '../server/auth.js';

export const PASSWORD = 'een-lang-testwachtwoord';
const HASH = hashPassword(PASSWORD);

export async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wowround-test-'));
  // Eerst op een vrije poort starten om het adres te weten.
  const config = {
    isDev: true,
    host: '127.0.0.1',
    port: 0,
    publicUrl: null,
    origin: null,
    secureCookies: false,
    trustProxy: false,
    appSecret: 'x'.repeat(48),
    sessionTtlMs: 3600_000,
    ownerPasswordHash: HASH,
    dataDir,
    stunUrls: ['stun:stun.example.org:3478'],
    turnUrls: [],
    turnSecret: null,
    turnTtlSeconds: 3600,
  };
  const net = await import('node:net');
  const port = await new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
  config.port = port;
  config.origin = `http://127.0.0.1:${port}`;
  config.publicUrl = new URL(config.origin);

  const silent = { warn() {}, error() {}, log() {} };
  const app = createApp(config, { log: silent });
  await new Promise((resolve) => app.server.listen(port, '127.0.0.1', resolve));

  return {
    app,
    config,
    base: config.origin,
    async stop() {
      await app.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export async function login(srv, password = PASSWORD) {
  const res = await fetch(`${srv.base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: srv.base },
    body: JSON.stringify({ password }),
  });
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  return { res, cookie };
}

export async function api(srv, cookie, method, pathname, body) {
  const res = await fetch(`${srv.base}${pathname}`, {
    method,
    headers: {
      Origin: srv.base,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// WebSocket-client die berichten in een wachtrij zet, zodat tests op een type kunnen wachten.
export function connect(srv, { cookie, origin = srv.base } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${srv.base.replace('http', 'ws')}/ws`, {
      headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
    });
    const queue = [];
    const waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const i = waiters.findIndex((w) => w.type === msg.t);
      if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
      else queue.push(msg);
    });
    ws.next = (type, timeout = 2000) => {
      const i = queue.findIndex((m) => m.t === type);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((res, rej) => {
        const timer = setTimeout(() => rej(new Error(`Geen '${type}' ontvangen`)), timeout);
        waiters.push({ type, resolve: (m) => (clearTimeout(timer), res(m)) });
      });
    };
    ws.sendJson = (obj) => ws.send(JSON.stringify(obj));
    ws.closed = new Promise((res) => ws.on('close', (code) => res(code)));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    ws.on('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
  });
}

export function keyFrom(guestUrl) {
  return new URL(guestUrl).hash.replace('#k=', '');
}
