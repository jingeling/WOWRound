// Signalering: de server stelt twee browsers aan elkaar voor en houdt de wachtruimte bij.
//
// De server ziet nooit beeld of geluid (principe 10). Hij geeft alleen
// verbindingsvoorstellen (SDP) en netwerkkandidaten (ICE) door tussen precies twee
// deelnemers die mogen praten: de ingelogde eigenaar en één toegelaten gast (principe 9).
// Wat de server wél ziet: wie er in welke ruimte zit en wanneer (principe 15).

import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { iceServers } from './ice.js';
import { cleanRoomName } from './rooms.js';

const MAX_LOBBY = 5;
const REJOIN_TTL_MS = 10 * 60_000;
const HEARTBEAT_MS = 30_000;

function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function cleanName(value) {
  if (typeof value !== 'string') return '';
  return cleanRoomName(value).slice(0, 40);
}

export function createSignaling({ server, config, rooms, isOwnerRequest, ipOf, guestLimiter }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  // ruimte-id → { owner, guest, lobby: Map<gastId, ws>, tickets: Map<ticket, {name, expiresAt}> }
  const live = new Map();

  function stateFor(roomId) {
    let s = live.get(roomId);
    if (!s) {
      s = { owner: null, guest: null, lobby: new Map(), tickets: new Map() };
      live.set(roomId, s);
    }
    return s;
  }

  function cleanup(roomId) {
    const s = live.get(roomId);
    if (!s) return;
    const now = Date.now();
    for (const [t, v] of s.tickets) if (v.expiresAt < now) s.tickets.delete(t);
    if (!s.owner && !s.guest && s.lobby.size === 0 && s.tickets.size === 0) live.delete(roomId);
  }

  function sendLobby(s) {
    send(s.owner, { t: 'lobby', guests: [...s.lobby.values()].map((g) => ({ id: g.id, name: g.name })) });
  }

  function pair(s) {
    if (!s.owner || !s.guest) return;
    // De gast is de "beleefde" partij bij botsende voorstellen (perfect negotiation).
    send(s.owner, { t: 'peer', peer: { name: s.guest.name, role: 'guest' }, polite: false });
    send(s.guest, { t: 'peer', peer: { name: 'Gastheer', role: 'owner' }, polite: true });
  }

  function admit(s, room, guest) {
    s.lobby.delete(guest.id);
    s.guest = guest;
    guest.admitted = true;
    const ticket = crypto.randomBytes(24).toString('base64url');
    s.tickets.set(ticket, { name: guest.name, expiresAt: Date.now() + REJOIN_TTL_MS });
    guest.ticket = ticket;
    send(guest, {
      t: 'joined',
      role: 'guest',
      roomName: room.name,
      ticket,
      ice: iceServers(config, 'guest'),
    });
    sendLobby(s);
    pair(s);
  }

  function leave(ws) {
    const roomId = ws.roomId;
    if (!roomId) return;
    const s = live.get(roomId);
    ws.roomId = null;
    if (!s) return;

    if (s.owner === ws) {
      s.owner = null;
      // Toegelaten gast blijft verbonden en wacht; bij terugkeer worden ze direct gekoppeld.
      if (s.guest) {
        send(s.guest, { t: 'peer-left' });
        send(s.guest, { t: 'waiting', reason: 'host-absent' });
      }
      for (const g of s.lobby.values()) send(g, { t: 'waiting', reason: 'host-absent' });
    } else if (s.guest === ws) {
      s.guest = null;
      if (ws.ticket) {
        // Ticket blijft even geldig zodat herladen van de pagina niet opnieuw toelating vraagt.
        const entry = s.tickets.get(ws.ticket);
        if (entry) entry.expiresAt = Date.now() + REJOIN_TTL_MS;
      }
      send(s.owner, { t: 'peer-left' });
    } else if (s.lobby.has(ws.id)) {
      s.lobby.delete(ws.id);
      sendLobby(s);
    }
    cleanup(roomId);
  }

  function handleJoin(ws, msg) {
    if (ws.roomId) return send(ws, { t: 'error', code: 'already-joined' });
    const room = rooms.get(msg.room);

    if (msg.role === 'owner') {
      if (!ws.isOwner) return send(ws, { t: 'error', code: 'not-authorized' });
      if (!room) return send(ws, { t: 'error', code: 'no-room' });
      const s = stateFor(room.id);
      if (s.owner && s.owner !== ws) {
        // Nieuwste tabblad wint; het oude wordt netjes gesloten.
        const old = s.owner;
        s.owner = null;
        old.roomId = null;
        send(old, { t: 'error', code: 'replaced' });
        old.close(4000, 'replaced');
      }
      ws.roomId = room.id;
      ws.role = 'owner';
      s.owner = ws;
      send(ws, { t: 'joined', role: 'owner', roomName: room.name, ice: iceServers(config, 'owner') });
      sendLobby(s);
      if (s.guest) pair(s);
      for (const g of s.lobby.values()) send(g, { t: 'waiting', reason: 'awaiting-admission' });
      return;
    }

    if (msg.role === 'guest') {
      if (!guestLimiter.take(ws.ip)) return send(ws, { t: 'error', code: 'rate-limited' });
      const verified = rooms.verifyGuestKey(msg.room, msg.key);
      if (!verified) return send(ws, { t: 'error', code: 'bad-link' });
      const s = stateFor(verified.id);

      ws.roomId = verified.id;
      ws.role = 'guest';
      ws.id = crypto.randomBytes(9).toString('base64url');
      ws.name = cleanName(msg.name) || 'Gast';

      // Terugkeer met een geldig ticket: direct binnen, als de plek vrij is.
      const ticket = typeof msg.ticket === 'string' ? s.tickets.get(msg.ticket) : null;
      if (ticket && ticket.expiresAt > Date.now() && !s.guest) {
        s.tickets.delete(msg.ticket);
        ws.name = ticket.name;
        admit(s, verified, ws);
        if (!s.owner) send(ws, { t: 'waiting', reason: 'host-absent' });
        return;
      }

      if (s.lobby.size >= MAX_LOBBY) {
        ws.roomId = null;
        return send(ws, { t: 'error', code: 'lobby-full' });
      }
      s.lobby.set(ws.id, ws);
      send(ws, { t: 'waiting', reason: s.owner ? 'awaiting-admission' : 'host-absent' });
      sendLobby(s);
      return;
    }

    send(ws, { t: 'error', code: 'bad-role' });
  }

  function handleOwnerDecision(ws, msg, allow) {
    if (ws.role !== 'owner') return;
    const s = live.get(ws.roomId);
    const guest = s?.lobby.get(msg.guestId);
    if (!guest) return sendLobby(s);
    if (allow) {
      if (s.guest) {
        // Er is al een gast: die maakt plaats (precies twee deelnemers).
        const previous = s.guest;
        s.guest = null;
        if (previous.ticket) s.tickets.delete(previous.ticket);
        previous.roomId = null;
        send(previous, { t: 'error', code: 'removed' });
        previous.close(4001, 'removed');
      }
      admit(s, rooms.get(ws.roomId), guest);
    } else {
      s.lobby.delete(guest.id);
      guest.roomId = null;
      send(guest, { t: 'denied' });
      guest.close(4002, 'denied');
      sendLobby(s);
    }
  }

  function handleSignal(ws, msg) {
    const s = live.get(ws.roomId);
    if (!s || !s.owner || !s.guest) return;
    if (ws !== s.owner && ws !== s.guest) return;
    if (!msg.data || typeof msg.data !== 'object') return;
    const target = ws === s.owner ? s.guest : s.owner;
    send(target, { t: 'signal', data: msg.data });
  }

  wss.on('connection', (ws, req) => {
    ws.ip = ipOf(req);
    ws.isOwner = isOwnerRequest(req);
    ws.isAlive = true;
    ws.budget = { count: 0, resetAt: Date.now() + 10_000 };

    ws.on('pong', () => (ws.isAlive = true));

    ws.on('message', (raw, isBinary) => {
      if (isBinary) return ws.close(1003, 'binary');
      // Eenvoudige berichtenlimiet per verbinding.
      const now = Date.now();
      if (ws.budget.resetAt < now) ws.budget = { count: 0, resetAt: now + 10_000 };
      if (++ws.budget.count > 300) return ws.close(1008, 'rate');

      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return send(ws, { t: 'error', code: 'bad-json' });
      }
      if (!msg || typeof msg.t !== 'string') return;

      switch (msg.t) {
        case 'join':
          return handleJoin(ws, msg);
        case 'admit':
          return handleOwnerDecision(ws, msg, true);
        case 'deny':
          return handleOwnerDecision(ws, msg, false);
        case 'signal':
          return handleSignal(ws, msg);
        case 'leave':
          return leave(ws);
        default:
          return send(ws, { t: 'error', code: 'unknown-type' });
      }
    });

    ws.on('close', () => leave(ws));
    ws.on('error', () => leave(ws));
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
    for (const id of live.keys()) cleanup(id);
  }, HEARTBEAT_MS).unref();

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, config.origin);
    // Alleen WebSockets vanaf onze eigen pagina's (bescherming tegen cross-site misbruik).
    if (url.pathname !== '/ws' || req.headers.origin !== config.origin) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  return {
    close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
    // Wordt aangeroepen als een ruimte wordt verwijderd of de link wordt ingetrokken.
    evictGuests(roomId) {
      const s = live.get(roomId);
      if (!s) return;
      for (const g of [s.guest, ...s.lobby.values()].filter(Boolean)) {
        g.roomId = null;
        send(g, { t: 'error', code: 'bad-link' });
        g.close(4003, 'link-revoked');
      }
      s.guest = null;
      s.lobby.clear();
      s.tickets.clear();
      send(s.owner, { t: 'peer-left' });
      sendLobby(s);
    },
    evictRoom(roomId) {
      this.evictGuests(roomId);
      const s = live.get(roomId);
      if (s?.owner) {
        s.owner.roomId = null;
        send(s.owner, { t: 'error', code: 'no-room' });
        s.owner.close(4004, 'room-removed');
      }
      live.delete(roomId);
    },
  };
}
