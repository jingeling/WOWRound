import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RateLimiter, hashPassword, verifyPassword } from '../server/auth.js';
import { RoomStore } from '../server/rooms.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('wachtwoord-hash klopt en is gezouten', () => {
  const a = hashPassword('correct horse battery staple');
  const b = hashPassword('correct horse battery staple');
  assert.notEqual(a, b);
  assert.ok(verifyPassword('correct horse battery staple', a));
  assert.ok(!verifyPassword('Correct horse battery staple', a));
  assert.ok(!verifyPassword('', a));
  assert.ok(!verifyPassword(undefined, a));
  assert.ok(!verifyPassword('x', 'scrypt$1$2$3$$'));
});

test('rate limiter blokkeert na de limiet', () => {
  const rl = new RateLimiter({ limit: 2, windowMs: 60_000 });
  assert.ok(rl.take('a'));
  assert.ok(rl.take('a'));
  assert.ok(!rl.take('a'));
  assert.ok(rl.take('b'));
  rl.reset('a');
  assert.ok(rl.take('a'));
  rl.close();
});

test('gastsleutels: geldig, vervalsbaar noch herbruikbaar na intrekken', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wowround-rooms-'));
  const store = new RoomStore({ dataDir: dir, secret: 's'.repeat(40) });
  const room = store.create('Pairen met Sam');
  const key = store.guestKey(room);

  assert.equal(key.length, 32);
  assert.ok(store.verifyGuestKey(room.id, key));
  assert.ok(!store.verifyGuestKey(room.id, key.slice(0, -1) + (key.at(-1) === 'a' ? 'b' : 'a')));
  assert.ok(!store.verifyGuestKey(room.id, 'kort'));

  store.rotateKey(room.id);
  assert.ok(!store.verifyGuestKey(room.id, key), 'oude link werkt niet meer');
  assert.ok(store.verifyGuestKey(room.id, store.guestKey(room)));

  // Ander geheim = andere sleutels.
  const other = new RoomStore({ dataDir: dir, secret: 't'.repeat(40) });
  assert.ok(!other.verifyGuestKey(room.id, store.guestKey(room)));

  // Opslag overleeft een herstart en bevat geen sleutels.
  const raw = fs.readFileSync(path.join(dir, 'rooms.json'), 'utf8');
  assert.ok(!raw.includes(store.guestKey(room)));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ruimtenamen worden opgeschoond', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wowround-rooms-'));
  const store = new RoomStore({ dataDir: dir, secret: 's'.repeat(40) });
  assert.equal(store.create('  Hallo\u0000\u001b wereld  ').name, 'Hallo wereld');
  assert.equal(store.create('').name, 'Naamloze ruimte');
  assert.equal(store.create('x'.repeat(200)).name.length, 60);
  fs.rmSync(dir, { recursive: true, force: true });
});
