// Vaste ruimtes met vaste uitnodigingslinks (principe 3).
//
// Elke ruimte heeft een geheime gastsleutel: HMAC(APP_SECRET, ruimte-id + versie).
// De sleutel wordt nergens opgeslagen; de server rekent hem na. Een link intrekken
// betekent de versie ophogen, waarna de oude link niet meer werkt.
//
// Opslag is één klein JSON-bestand. Er staan geen namen van gasten,
// geen gespreksgeschiedenis en geen logs in (principe 14).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // zonder verwarrende tekens (l, o, 0, 1)

export function randomId(length = 10) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

export function isRoomId(value) {
  return typeof value === 'string' && /^[a-km-np-z2-9]{10}$/.test(value);
}

export function cleanRoomName(value) {
  if (typeof value !== 'string') return '';
  // Geen stuurtekens, maximaal 60 tekens.
  return value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
}

export class RoomStore {
  constructor({ dataDir, secret }) {
    this.file = path.join(dataDir, 'rooms.json');
    this.secret = secret;
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.rooms = this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return new Map(parsed.rooms.filter((r) => isRoomId(r.id)).map((r) => [r.id, r]));
    } catch (err) {
      if (err.code === 'ENOENT') return new Map();
      throw new Error(`Kan ${this.file} niet lezen: ${err.message}`);
    }
  }

  save() {
    // Atomisch schrijven: eerst naar een tijdelijk bestand, dan hernoemen.
    const tmp = `${this.file}.${process.pid}.tmp`;
    const data = JSON.stringify({ version: 1, rooms: [...this.rooms.values()] }, null, 2);
    fs.writeFileSync(tmp, data, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  list() {
    return [...this.rooms.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(id) {
    return isRoomId(id) ? this.rooms.get(id) || null : null;
  }

  create(name) {
    let id;
    do id = randomId(); while (this.rooms.has(id));
    const room = { id, name: cleanRoomName(name) || 'Naamloze ruimte', keyVersion: 1, createdAt: new Date().toISOString() };
    this.rooms.set(id, room);
    this.save();
    return room;
  }

  rename(id, name) {
    const room = this.get(id);
    if (!room) return null;
    room.name = cleanRoomName(name) || room.name;
    this.save();
    return room;
  }

  // Trekt de huidige uitnodigingslink in en maakt een nieuwe.
  rotateKey(id) {
    const room = this.get(id);
    if (!room) return null;
    room.keyVersion += 1;
    this.save();
    return room;
  }

  remove(id) {
    const existed = this.rooms.delete(id);
    if (existed) this.save();
    return existed;
  }

  guestKey(room) {
    return crypto
      .createHmac('sha256', this.secret)
      .update(`wowround:guest:${room.id}:${room.keyVersion}`)
      .digest('base64url')
      .slice(0, 32);
  }

  verifyGuestKey(id, key) {
    const room = this.get(id);
    if (!room || typeof key !== 'string' || key.length !== 32) return null;
    const expected = Buffer.from(this.guestKey(room));
    const actual = Buffer.from(key);
    if (actual.length !== expected.length) return null;
    return crypto.timingSafeEqual(actual, expected) ? room : null;
  }
}
