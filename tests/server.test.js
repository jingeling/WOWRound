import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { api, connect, keyFrom, login, startServer } from './helpers.js';

let srv;
let cookie;
let room;

before(async () => {
  srv = await startServer();
  ({ cookie } = await login(srv));
  room = (await api(srv, cookie, 'POST', '/api/rooms', { name: 'Testruimte' })).json.room;
});
after(() => srv.stop());

describe('HTTP en inloggen', () => {
  test('beveiligingsheaders staan op elke response', async () => {
    const res = await fetch(`${srv.base}/login`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  });

  test('startpagina vraagt eerst om in te loggen', async () => {
    const res = await fetch(`${srv.base}/`, { redirect: 'manual' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), '/login');
  });

  test('fout wachtwoord geeft 401, sessiecookie is HttpOnly en SameSite=Strict', async () => {
    const bad = await login(srv, 'fout');
    assert.equal(bad.res.status, 401);
    const good = await fetch(`${srv.base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: srv.base },
      body: JSON.stringify({ password: 'een-lang-testwachtwoord' }),
    });
    const setCookie = good.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
  });

  test('verzoeken vanaf een andere site worden geweigerd', async () => {
    const res = await fetch(`${srv.base}/api/rooms`, {
      method: 'POST',
      headers: { Origin: 'https://evil.example', Cookie: cookie, 'Content-Type': 'application/json' },
      body: '{"name":"x"}',
    });
    assert.equal(res.status, 403);
  });

  test('ruimte-API alleen voor de eigenaar', async () => {
    assert.equal((await api(srv, null, 'GET', '/api/rooms')).status, 401);
    const { status, json } = await api(srv, cookie, 'GET', '/api/rooms');
    assert.equal(status, 200);
    assert.equal(json.rooms[0].name, 'Testruimte');
    assert.match(json.rooms[0].guestUrl, /#k=/, 'sleutel staat achter het hekje');
  });

  test('padtraversal levert niets op', async () => {
    const res = await fetch(`${srv.base}/assets/..%2f..%2fpackage.json`);
    assert.equal(res.status, 404);
  });

  test('inlogpogingen worden begrensd', async () => {
    const results = [];
    for (let i = 0; i < 7; i++) results.push((await login(srv, 'nog-steeds-fout')).res.status);
    assert.ok(results.includes(429));
  });
});

describe('signalering en wachtruimte', () => {
  test('WebSocket vanaf een andere origin wordt geweigerd', async () => {
    await assert.rejects(connect(srv, { origin: 'https://evil.example' }), /403/);
  });

  test('zonder sessie kun je geen eigenaar zijn', async () => {
    const ws = await connect(srv);
    ws.sendJson({ t: 'join', room: room.id, role: 'owner' });
    assert.equal((await ws.next('error')).code, 'not-authorized');
    ws.close();
  });

  test('gast met verkeerde sleutel komt er niet in', async () => {
    const ws = await connect(srv);
    ws.sendJson({ t: 'join', room: room.id, role: 'guest', key: 'x'.repeat(32), name: 'Indringer' });
    assert.equal((await ws.next('error')).code, 'bad-link');
    ws.close();
  });

  test('volledige flow: wachtruimte, toelaten, signalen doorgeven, vertrekken, terugkeren', async () => {
    const key = keyFrom(room.guestUrl);

    // Gast komt eerst: gastheer is er nog niet.
    const guest = await connect(srv);
    guest.sendJson({ t: 'join', room: room.id, role: 'guest', key, name: 'Sam <script>' });
    assert.equal((await guest.next('waiting')).reason, 'host-absent');

    // Eigenaar komt binnen en ziet Sam in de wachtruimte.
    const owner = await connect(srv, { cookie });
    owner.sendJson({ t: 'join', room: room.id, role: 'owner' });
    const joined = await owner.next('joined');
    assert.equal(joined.roomName, 'Testruimte');
    assert.ok(joined.ice.length >= 1);
    let lobby = await owner.next('lobby');
    if (!lobby.guests.length) lobby = await owner.next('lobby');
    assert.equal(lobby.guests.length, 1);
    assert.equal(lobby.guests[0].name, 'Sam <script>', 'naam wordt als tekst doorgegeven, browser escapet');
    assert.equal((await guest.next('waiting')).reason, 'awaiting-admission');

    // Signalen voor toelating worden genegeerd.
    guest.sendJson({ t: 'signal', data: { sdp: 'stiekem' } });

    owner.sendJson({ t: 'admit', guestId: lobby.guests[0].id });
    const gJoined = await guest.next('joined');
    assert.ok(gJoined.ticket);
    assert.equal((await guest.next('peer')).polite, true);
    assert.equal((await owner.next('peer')).polite, false);

    // Doorgeven in beide richtingen.
    owner.sendJson({ t: 'signal', data: { description: { type: 'offer', sdp: 'v=0' } } });
    assert.equal((await guest.next('signal')).data.description.type, 'offer');
    guest.sendJson({ t: 'signal', data: { candidate: 'c' } });
    const sig = await owner.next('signal');
    assert.equal(sig.data.candidate, 'c', 'eerste signaal dat aankomt is het toegelaten signaal, niet het stiekeme');

    // Gast herlaadt: met ticket direct weer binnen.
    guest.close();
    await owner.next('peer-left');
    const guest2 = await connect(srv);
    guest2.sendJson({ t: 'join', room: room.id, role: 'guest', key, name: 'iets anders', ticket: gJoined.ticket });
    await guest2.next('joined');
    await owner.next('peer');

    // Ticket werkt maar één keer.
    const guest3 = await connect(srv);
    guest3.sendJson({ t: 'join', room: room.id, role: 'guest', key, name: 'Kopie', ticket: gJoined.ticket });
    assert.equal((await guest3.next('waiting')).reason, 'awaiting-admission');

    // Eigenaar weigert de derde.
    lobby = await owner.next('lobby');
    while (!lobby.guests.length) lobby = await owner.next('lobby');
    owner.sendJson({ t: 'deny', guestId: lobby.guests[0].id });
    await guest3.next('denied');
    assert.equal(await guest3.closed, 4002);

    // Link intrekken zet de huidige gast eruit.
    const rotated = await api(srv, cookie, 'POST', `/api/rooms/${room.id}/rotate`);
    assert.equal(rotated.status, 200);
    assert.equal((await guest2.next('error')).code, 'bad-link');
    await guest2.closed;
    room = rotated.json.room;

    owner.close();
  });

  test('een tweede tabblad van de eigenaar vervangt het eerste', async () => {
    const a = await connect(srv, { cookie });
    a.sendJson({ t: 'join', room: room.id, role: 'owner' });
    await a.next('joined');
    const b = await connect(srv, { cookie });
    b.sendJson({ t: 'join', room: room.id, role: 'owner' });
    await b.next('joined');
    assert.equal((await a.next('error')).code, 'replaced');
    b.close();
  });

  test('ruimte verwijderen', async () => {
    const extra = (await api(srv, cookie, 'POST', '/api/rooms', { name: 'Weg' })).json.room;
    assert.equal((await api(srv, cookie, 'DELETE', `/api/rooms/${extra.id}`)).status, 200);
    const ws = await connect(srv);
    ws.sendJson({ t: 'join', room: extra.id, role: 'guest', key: keyFrom(extra.guestUrl), name: 'x' });
    assert.equal((await ws.next('error')).code, 'bad-link');
    ws.close();
  });
});

describe('overal uitloggen', () => {
  // Eigen server: de server hierboven heeft na de test met foute wachtwoorden een inlogblokkade.
  test('maakt alle sessies ongeldig, ook op andere apparaten', async () => {
    const own = await startServer();
    const laptop = (await login(own)).cookie;
    const telefoon = (await login(own)).cookie;
    assert.equal((await api(own, telefoon, 'GET', '/api/rooms')).status, 200);
    assert.equal((await api(own, laptop, 'POST', '/api/logout-all')).status, 200);
    assert.equal((await api(own, telefoon, 'GET', '/api/rooms')).status, 401);
    assert.equal((await api(own, laptop, 'GET', '/api/rooms')).status, 401);
    assert.equal((await api(own, null, 'POST', '/api/logout-all')).status, 401, 'zonder sessie niet toegestaan');
    await own.stop();
  });
});
