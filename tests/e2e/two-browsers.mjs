// End-to-end test met twee echte browsers (nepcamera en nepmicrofoon).
// Controleert: inloggen, ruimte maken, wachtruimte, toelaten, rechtstreekse verbinding,
// schermdelen, aanwijzen, microfoon dempen en ophangen.
//
// Vereist Playwright met Chromium:
//   npm i -D playwright && npx playwright install chromium
//   node tests/e2e/two-browsers.mjs
// Zet CHROMIUM_PATH als je een eigen Chromium wilt gebruiken.
// Zet SHOTS=map om schermafbeeldingen op te slaan.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const PORT = 3870;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'e2e-wachtwoord-lang-genoeg';
const SHOTS = process.env.SHOTS;
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

function hash(password) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, ['scripts/hash-password.js'], { cwd: root, env: { ...process.env, WOWROUND_PASSWORD: password } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('close', (code) => (code ? reject(new Error('hash mislukt')) : resolve(out.match(/OWNER_PASSWORD_HASH=(\S+)/)[1])));
  });
}

async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wowround-e2e-'));
  const proc = spawn(process.execPath, ['server/index.js'], {
    cwd: root,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(PORT),
      PUBLIC_URL: BASE,
      APP_SECRET: 'e'.repeat(48),
      OWNER_PASSWORD_HASH: await hash(PASSWORD),
      DATA_DIR: dataDir,
      STUN_URLS: '',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve) => proc.stdout.on('data', (d) => d.toString().includes('luistert') && resolve()));
  return { proc, dataDir };
}

// Nep-schermdelen: een canvas met bewegende tekst, zodat er echte frames zijn.
const fakeDisplay = () => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 });
    const ctx = canvas.getContext('2d');
    let n = 0;
    setInterval(() => {
      ctx.fillStyle = '#f4f6f8';
      ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = '#1d2430';
      ctx.font = '28px monospace';
      for (let i = 0; i < 18; i++) ctx.fillText(`function samenwerken${i}() { return ${n + i}; }`, 40, 50 + i * 36);
      n++;
    }, 100);
    return canvas.captureStream(15);
  };
};

const step = (msg) => console.log(`✓ ${msg}`);
const shot = async (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`) });

async function main() {
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const { proc, dataDir } = await startServer();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
  });

  try {
    const ownerCtx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera', 'microphone', 'clipboard-read', 'clipboard-write'] });
    const guestCtx = await browser.newContext({ viewport: { width: 1100, height: 760 }, permissions: ['camera', 'microphone'] });
    await ownerCtx.addInitScript(fakeDisplay);
    for (const ctx of [ownerCtx, guestCtx]) {
      // Verbindingen bijhouden voor foutdiagnose.
      await ctx.addInitScript(() => {
        window.__pcs = [];
        window.__pclog = [];
        const Orig = window.RTCPeerConnection;
        window.RTCPeerConnection = function (...args) {
          const pc = new Orig(...args);
          const id = window.__pcs.push(pc);
          const log = (what) => window.__pclog.push(`${id} ${what} sig=${pc.signalingState} ice=${pc.iceConnectionState} conn=${pc.connectionState}`);
          for (const ev of ['signalingstatechange', 'iceconnectionstatechange', 'connectionstatechange', 'icegatheringstatechange']) pc.addEventListener(ev, () => log(ev));
          pc.addEventListener('icecandidate', (e) => log(`cand ${e.candidate ? e.candidate.candidate.split(' ').slice(4, 8).join(' ') : 'end'}`));
          for (const m of ['setLocalDescription', 'setRemoteDescription', 'addIceCandidate']) {
            const orig = pc[m].bind(pc);
            pc[m] = (...a) => { log(`${m}(${a[0]?.type || (a[0]?.candidate ? 'cand' : '')})`); return orig(...a).catch((err) => { log(`${m} FOUT ${err.message}`); throw err; }); };
          }
          return pc;
        };
        window.RTCPeerConnection.prototype = Orig.prototype;
      });
    }
    // Tel gestarte tonen, zodat we kunnen controleren dat de deurbel klinkt.
    await ownerCtx.addInitScript(() => {
      window.__tones = 0;
      const start = OscillatorNode.prototype.start;
      OscillatorNode.prototype.start = function (...args) {
        window.__tones++;
        return start.apply(this, args);
      };
    });
    await guestCtx.addInitScript(fakeDisplay);
    const owner = await ownerCtx.newPage();
    const guest = await guestCtx.newPage();
    for (const [p, who] of [[owner, 'eigenaar'], [guest, 'gast']]) {
      p.on('pageerror', (e) => console.error(`[${who}] paginafout:`, e.message));
      p.on('console', (m) => m.type() === 'error' && console.error(`[${who}] console:`, m.text()));
    }

    // Inloggen en een ruimte maken.
    await owner.goto(`${BASE}/login`);
    await shot(owner, '01-login');
    await owner.fill('#password', PASSWORD);
    await owner.click('button[type=submit]');
    await owner.waitForURL(`${BASE}/`);
    await owner.fill('#room-name', 'Pairen met Sam');
    await owner.click('#create-form button');
    await owner.waitForSelector('.room-row h2:text("Pairen met Sam")');
    await shot(owner, '02-ruimtes');
    const { rooms } = await (await owner.request.get(`${BASE}/api/rooms`)).json();
    const room = rooms[0];
    step('ingelogd en ruimte gemaakt');

    // Eigenaar opent de ruimte.
    await owner.goto(room.ownerUrl);
    await owner.fill('#display-name', 'Jinge');
    await owner.waitForSelector('#prejoin-submit:enabled');
    await owner.waitForTimeout(500);
    await shot(owner, '03-vooraf');
    await owner.click('#prejoin-submit');
    await owner.waitForSelector('#controls:not([hidden])');
    step('eigenaar zit in de ruimte');

    // Gast klopt aan.
    await guest.goto(room.guestUrl);
    await guest.fill('#display-name', 'Sam');
    await guest.click('#prejoin-submit');
    await guest.waitForSelector('#prejoin-title:text("Even wachten")');
    await owner.waitForSelector('#knock:not([hidden]) .knock-row');
    await owner.waitForFunction(() => window.__tones >= 8, null, { timeout: 3000 });
    step('deurbel klinkt bij de eigenaar');
    await shot(owner, '04-aankloppen');
    step('gast staat in de wachtruimte, eigenaar ziet het');

    await owner.click('#knock button.btn-primary');
    await guest.waitForSelector('#controls:not([hidden])');

    // Rechtstreekse verbinding met beeld aan beide kanten.
    const remoteVideoPlaying = (page) =>
      page.waitForFunction(() => {
        const videos = [...document.querySelectorAll('.bubble video')].filter((v) => !v.muted);
        return videos.some((v) => v.readyState >= 2 && v.videoWidth > 0);
      }, null, { timeout: 15000 });
    await Promise.all([remoteVideoPlaying(owner), remoteVideoPlaying(guest)]).catch(async (err) => {
      for (const [p, who] of [[owner, 'eigenaar'], [guest, 'gast']]) {
        console.error(`  [${who}] pc-log:\n    ` + (await p.evaluate(() => window.__pclog.join('\n    '))));
        console.error(`  [${who}] status: "${await p.textContent('#status')}", bubbels:`, await p.evaluate(() =>
          [...document.querySelectorAll('.bubble video')].map((v) => ({ muted: v.muted, ready: v.readyState, w: v.videoWidth, tracks: v.srcObject?.getTracks().map((t) => `${t.kind}:${t.readyState}:${t.muted ? 'muted' : 'live'}`) }))));
      }
      throw err;
    });
    await owner.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Verbonden'), null, { timeout: 10000 });
    console.log(`  status eigenaar: ${await owner.textContent('#status')}`);
    await owner.waitForTimeout(800);
    await shot(owner, '05-gesprek');
    step('peer-to-peer verbonden, beide zien elkaars camera');

    // Namen komen over het datakanaal.
    await owner.waitForSelector('.bubble .name:text("Sam")');
    await guest.waitForSelector('.bubble .name:text("Jinge")');
    step('namen uitgewisseld via datakanaal');

    // Eigenaar deelt een venster; gast ziet het.
    await owner.click('#btn-share');
    await guest.waitForFunction(() => {
      const v = document.querySelector('#screen-video');
      return !document.querySelector('#screen-wrap').hidden && v.videoWidth >= 1280;
    }, null, { timeout: 15000 });
    const res = await guest.evaluate(() => {
      const v = document.querySelector('#screen-video');
      return `${v.videoWidth}x${v.videoHeight}`;
    });
    console.log(`  resolutie bij gast: ${res}`);
    step('scherm gedeeld en ontvangen in volle resolutie');

    // Gast wijst aan; eigenaar ziet de aanwijzer op het eigen voorbeeld.
    const box = await guest.locator('#screen-video').boundingBox();
    await guest.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
    await guest.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.45, { steps: 5 });
    await owner.waitForFunction(() => {
      const c = document.querySelector('#annotate');
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
      return false;
    }, null, { timeout: 5000 });
    await shot(owner, '06-aanwijzen-eigenaar');
    await shot(guest, '07-scherm-gast');
    step('aanwijzer van de gast verschijnt bij de eigenaar');

    // Gast neemt het podium over.
    await guest.click('#btn-share');
    await owner.waitForFunction(() => document.querySelector('#btn-share').getAttribute('aria-pressed') === 'false', null, { timeout: 10000 });
    await owner.waitForFunction(() => document.querySelector('#screen-video').videoWidth >= 1280, null, { timeout: 15000 });
    step('maar één scherm tegelijk: gast neemt het delen over');
    await guest.click('#btn-share');
    await owner.waitForSelector('#screen-wrap[hidden]', { state: 'attached', timeout: 10000 });
    step('delen gestopt, terug naar de bubbels');

    // Microfoon dempen is zichtbaar bij de ander.
    await guest.keyboard.press('m');
    await owner.waitForSelector('.bubble.mic-off .name:text("Sam")', { state: 'attached', timeout: 5000 }).catch(async () => {
      await owner.waitForFunction(() => [...document.querySelectorAll('.bubble.mic-off')].length > 0, null, { timeout: 5000 });
    });
    step('gedempte microfoon zichtbaar bij de ander');

    // Camera uit: lampje uit, initialen bij de ander.
    await guest.keyboard.press('v');
    await owner.waitForFunction(() => [...document.querySelectorAll('.bubble.cam-off')].length > 0, null, { timeout: 5000 });
    const guestTracks = await guest.evaluate(() => document.querySelector('.bubble.mirror video').srcObject.getVideoTracks().length);
    if (guestTracks !== 0) throw new Error('cameratrack niet gestopt');
    await shot(owner, '08-camera-uit');
    step('camera echt uit, ander ziet initialen');

    // Herladen: gast komt met ticket direct terug zonder opnieuw aan te kloppen.
    await guest.reload();
    await guest.click('#prejoin-submit');
    await guest.waitForSelector('#controls:not([hidden])', { timeout: 10000 });
    await remoteVideoPlaying(owner);
    step('gast herlaadt en komt direct terug (ticket)');

    // Ophangen.
    await guest.click('#btn-leave');
    await guest.waitForSelector('#ended:not([hidden])');
    await owner.waitForFunction(() => document.querySelector('#idle-text').textContent.includes('Nog niemand'), null, { timeout: 5000 });
    await shot(guest, '09-opgehangen');
    step('ophangen werkt, eigenaar ziet lege ruimte');

    // Ongeldige link.
    const intruder = await (await browser.newContext()).newPage();
    await intruder.goto(`${BASE}/r/${room.id}#k=${'x'.repeat(32)}`);
    await intruder.fill('#display-name', 'Indringer');
    await intruder.click('#prejoin-submit');
    await intruder.waitForSelector('#ended-title:text("Deze link werkt niet")');
    step('ongeldige gastlink wordt geweigerd');

    console.log('\nAlle browserstappen geslaagd.');
  } finally {
    await browser.close();
    proc.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('\n✗', err.message);
  process.exit(1);
});
