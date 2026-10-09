// De ruimte: vooraf checken, wachtruimte, gesprek, schermdelen en aanwijzen.

import { Annotator } from './annotate.js';
import { Bubble } from './bubbles.js';
import { primeDoorbell, ringDoorbell } from './doorbell.js';
import { Peer } from './peer.js';
import { Signal } from './signal.js';
import { $, api, copyText, el, store, toast } from './ui.js';

const roomId = location.pathname.split('/').pop();
const hashParams = new URLSearchParams(location.hash.slice(1));
const guestKey = hashParams.get('k');

const state = {
  role: null, // 'owner' | 'guest'
  name: '',
  joined: false,
  ice: [],
  signal: null,
  peer: null,
  peerName: '',
  localStream: new MediaStream(),
  micOn: true,
  camOn: true,
  screenStream: null, // mijn eigen gedeelde scherm
  remoteScreenId: null, // stream-ID van het scherm van de ander
  lobbyCount: 0,
  roomName: '',
};

const stage = $('#stage');
const bubbles = $('#bubbles');
const screenWrap = $('#screen-wrap');
const screenVideo = $('#screen-video');
const controls = $('#controls');

let selfBubble;
let peerBubble;
let previewBubble;

const annotator = new Annotator({
  canvas: $('#annotate'),
  video: screenVideo,
  send: (msg) => state.peer?.send(msg),
});

// ——— Teksten ———

const TEXT = {
  idleOwner: 'Nog niemand hier. Stuur de gastlink, of wacht tot je gast binnenkomt.',
  idleGuestHostAway: 'De gastheer is er even niet. Je komt automatisch terug in het gesprek.',
  waitingHost: 'De gastheer is er nog niet. Laat dit venster open; je komt binnen zodra die er is.',
  waitingAdmit: 'De gastheer weet dat je er bent. Even wachten tot je wordt binnengelaten.',
  errors: {
    'bad-link': ['Deze link werkt niet', 'De link is ongeldig of ingetrokken. Vraag de gastheer om een nieuwe.'],
    'not-authorized': ['Niet ingelogd', 'Log eerst in om deze ruimte te openen.'],
    'no-room': ['Ruimte bestaat niet', 'Deze ruimte is verwijderd.'],
    replaced: ['Geopend in een ander tabblad', 'Je zit al in deze ruimte in een ander venster.'],
    removed: ['Je bent uit het gesprek gezet', 'De gastheer heeft iemand anders binnengelaten.'],
    'lobby-full': ['De wachtruimte is vol', 'Probeer het over een paar minuten opnieuw.'],
    'rate-limited': ['Even geduld', 'Te veel pogingen in korte tijd. Probeer het over een minuut opnieuw.'],
  },
};

function setStatus(text) {
  $('#status').textContent = text || '';
}

function setIdle(text) {
  $('#idle-text').textContent = text || '';
}

function showEnded(title, text, { canRejoin = true } = {}) {
  teardownPeer();
  stopScreen(false);
  state.signal?.close();
  state.localStream.getTracks().forEach((t) => t.stop());
  $('#ended-title').textContent = title;
  $('#ended-text').textContent = text || '';
  $('#btn-rejoin').hidden = !canRejoin;
  $('#ended').hidden = false;
  $('#prejoin').hidden = true;
  controls.hidden = true;
  $('#menu').hidden = true;
  $('#knock').hidden = true;
}

function updateTitle() {
  const base = state.roomName ? `${state.roomName} · WOWRound` : 'WOWRound';
  document.title = state.lobbyCount ? `(${state.lobbyCount}) ${base}` : base;
}

// ——— Media ———

const audioConstraints = (deviceId) => ({
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
});

const videoConstraints = (deviceId) => ({
  width: { ideal: 640 },
  height: { ideal: 640 },
  aspectRatio: { ideal: 1 },
  frameRate: { ideal: 24, max: 30 },
  ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
});

async function startMedia() {
  const prefs = store.get('devices', {});
  const attempts = [
    { audio: audioConstraints(prefs.mic), video: videoConstraints(prefs.cam) },
    { audio: audioConstraints(), video: videoConstraints() },
    { audio: audioConstraints() },
  ];
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      stream.getTracks().forEach((t) => state.localStream.addTrack(t));
      state.camOn = stream.getVideoTracks().length > 0;
      return true;
    } catch (err) {
      if (err.name === 'NotAllowedError') break;
    }
  }
  state.micOn = false;
  state.camOn = false;
  return false;
}

function micTrack() {
  return state.localStream.getAudioTracks()[0] || null;
}

function camTrack() {
  return state.localStream.getVideoTracks()[0] || null;
}

function setMic(on) {
  const track = micTrack();
  if (!track) on = false;
  state.micOn = on;
  if (track) track.enabled = on;
  reflectToggles();
  state.peer?.send({ t: 'state', mic: state.micOn, cam: state.camOn });
}

async function setCam(on) {
  if (on && !camTrack()) {
    try {
      const prefs = store.get('devices', {});
      const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(prefs.cam) });
      state.localStream.addTrack(stream.getVideoTracks()[0]);
    } catch {
      toast('De camera is niet beschikbaar');
      on = false;
    }
  }
  if (!on && camTrack()) {
    // Echt uitzetten (lampje uit), niet alleen zwart beeld sturen.
    const track = camTrack();
    track.stop();
    state.localStream.removeTrack(track);
  }
  state.camOn = on;
  await state.peer?.replaceCameraTrack(camTrack());
  refreshLocalVideo();
  reflectToggles();
  state.peer?.send({ t: 'state', mic: state.micOn, cam: state.camOn });
}

function refreshLocalVideo() {
  // Nieuwe stream-instantie zodat het videoelement de wijziging oppakt.
  const view = new MediaStream(state.localStream.getTracks());
  selfBubble?.setStream(view);
  previewBubble?.setStream(view);
  selfBubble?.setState({ mic: state.micOn, cam: state.camOn });
  previewBubble?.setState({ mic: state.micOn, cam: state.camOn });
}

function reflectToggles() {
  for (const [id, on, iconOn, iconOff] of [
    ['btn-mic', state.micOn, 'i-mic', 'i-mic-off'],
    ['pre-mic', state.micOn, 'i-mic', 'i-mic-off'],
    ['btn-cam', state.camOn, 'i-cam', 'i-cam-off'],
    ['pre-cam', state.camOn, 'i-cam', 'i-cam-off'],
  ]) {
    const btn = document.getElementById(id);
    btn.setAttribute('aria-pressed', String(on));
    btn.querySelector('use').setAttribute('href', `#${on ? iconOn : iconOff}`);
  }
  selfBubble?.setState({ mic: state.micOn, cam: state.camOn });
  previewBubble?.setState({ mic: state.micOn, cam: state.camOn });
}

// ——— Schermdelen ———

async function startScreen() {
  if (!navigator.mediaDevices.getDisplayMedia) return toast('Deze browser kan geen scherm delen');
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      // Een venster delen is de standaard; je hele scherm kan nog steeds (principe 8).
      video: { displaySurface: 'window', frameRate: { ideal: 15, max: 30 }, width: { max: 3840 }, height: { max: 2160 } },
      audio: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include',
    });
  } catch {
    return; // geannuleerd
  }
  const track = stream.getVideoTracks()[0];
  if ('contentHint' in track) track.contentHint = 'detail'; // tekst scherp houden
  track.addEventListener('ended', () => stopScreen(true));

  state.screenStream = stream;
  state.remoteScreenId = null;
  state.peer?.addScreen(stream);
  state.peer?.send({ t: 'screen', active: true, streamId: stream.id });
  showScreen(stream, true);
}

function stopScreen(announce) {
  if (!state.screenStream) return;
  state.screenStream.getTracks().forEach((t) => t.stop());
  state.screenStream = null;
  state.peer?.removeScreen();
  if (announce) state.peer?.send({ t: 'screen', active: false });
  if (!state.remoteScreenId) hideScreen();
  reflectShare();
}

function showScreen(stream, mine) {
  screenVideo.srcObject = stream;
  screenVideo.play().catch(() => {});
  screenWrap.hidden = false;
  stage.classList.add('sharing');
  $('#btn-draw').hidden = false;
  annotator.remoteName = state.peerName;
  annotator.start();
  setLayout('share');
  reflectShare();
  scheduleFade();
  setStatus(mine ? 'Je deelt een venster' : `${state.peerName || 'De ander'} deelt een venster`);
}

function hideScreen() {
  screenVideo.srcObject = null;
  screenWrap.hidden = true;
  stage.classList.remove('sharing');
  $('#btn-draw').hidden = true;
  setDraw(false);
  annotator.stop();
  setLayout('idle');
  reflectShare();
  showControls();
  if (state.peer) updateConnectionStatus();
}

function reflectShare() {
  $('#btn-share').setAttribute('aria-pressed', String(Boolean(state.screenStream)));
}

function setDraw(on) {
  annotator.setDrawing(on);
  $('#btn-draw').setAttribute('aria-pressed', String(on));
}

// ——— Bubbels en indeling ———

let layoutMode = 'idle';
const DEFAULTS = {
  idle: { self: [0.4, 0.48], peer: [0.6, 0.48] },
  share: { self: [0.93, 0.62], peer: [0.93, 0.8] },
};

function setLayout(mode) {
  layoutMode = mode;
  if (selfBubble) {
    selfBubble.key = `self:${mode}`;
    selfBubble.restoreOr(...DEFAULTS[mode].self);
  }
  if (peerBubble) {
    peerBubble.key = `peer:${mode}`;
    peerBubble.restoreOr(...DEFAULTS[mode].peer);
  }
}

window.addEventListener('resize', () => {
  selfBubble?.clamp();
  peerBubble?.clamp();
});

// ——— Verbinding met de ander ———

function createPeer({ polite, name }) {
  teardownPeer();
  state.peerName = name;
  state.remoteScreenId = null;

  const peer = new Peer({
    iceServers: state.ice,
    polite,
    sendSignal: (data) => state.signal.send({ t: 'signal', data }),
  });
  state.peer = peer;

  peer.addCamera(state.localStream);
  if (state.screenStream) peer.addScreen(state.screenStream);

  peerBubble = new Bubble({ container: bubbles, key: `peer:${layoutMode}`, name });
  peerBubble.restoreOr(...DEFAULTS[layoutMode].peer);
  peerBubble.setState({ mic: true, cam: true });
  setIdle('');
  setStatus('Verbinden…');

  peer.addEventListener('channel-open', () => {
    peer.send({ t: 'hello', name: state.name, mic: state.micOn, cam: state.camOn });
    if (state.screenStream) peer.send({ t: 'screen', active: true, streamId: state.screenStream.id });
  });

  peer.addEventListener('track', ({ detail: { stream } }) => {
    if (stream.id === state.remoteScreenId) showScreen(stream, false);
    else peerBubble?.setStream(stream);
  });

  peer.addEventListener('data', ({ detail: msg }) => handlePeerData(msg));
  peer.addEventListener('state', updateConnectionStatus);
}

function handlePeerData(msg) {
  switch (msg.t) {
    case 'hello':
      if (typeof msg.name === 'string') {
        state.peerName = msg.name.slice(0, 40);
        peerBubble?.setName(state.peerName);
        annotator.remoteName = state.peerName;
      }
      peerBubble?.setState({ mic: msg.mic !== false, cam: msg.cam !== false });
      break;
    case 'state':
      peerBubble?.setState({ mic: msg.mic !== false, cam: msg.cam !== false });
      break;
    case 'screen':
      if (msg.active && typeof msg.streamId === 'string') {
        // Maar één scherm tegelijk: wie als laatste deelt, krijgt het podium.
        if (state.screenStream) {
          stopScreen(false);
          toast(`${state.peerName || 'De ander'} deelt nu een venster`);
        }
        state.remoteScreenId = msg.streamId;
        const stream = state.peer?.remoteStreams.get(msg.streamId);
        if (stream) showScreen(stream, false);
      } else {
        state.remoteScreenId = null;
        if (!state.screenStream) hideScreen();
      }
      break;
    default:
      annotator.handle(msg);
  }
}

async function updateConnectionStatus() {
  const peer = state.peer;
  if (!peer) return;
  const s = peer.pc.connectionState;
  if (s === 'connected') {
    const { route } = await peer.stats();
    if (!state.screenStream && !state.remoteScreenId) setStatus(`Verbonden, ${route}`);
  } else if (s === 'connecting' || s === 'new') setStatus('Verbinden…');
  else if (s === 'disconnected') setStatus('Verbinding hapert…');
  else if (s === 'failed') setStatus('Geen verbinding. Opnieuw proberen…');
}

function teardownPeer() {
  if (state.peer) {
    state.peer.close();
    state.peer = null;
  }
  if (state.remoteScreenId) {
    state.remoteScreenId = null;
    if (!state.screenStream) hideScreen();
  }
  peerBubble?.remove();
  peerBubble = null;
}

// ——— Signalering ———

function joinMessage() {
  if (state.role === 'owner') return { t: 'join', room: roomId, role: 'owner' };
  let ticket = null;
  try {
    ticket = sessionStorage.getItem(`wowround:ticket:${roomId}`);
  } catch {
    /* geen opslag */
  }
  return { t: 'join', room: roomId, role: 'guest', key: guestKey, name: state.name, ticket };
}

function connectSignal() {
  const signal = new Signal(joinMessage);
  state.signal = signal;

  signal.addEventListener('message', ({ detail: msg }) => {
    switch (msg.t) {
      case 'joined':
        onJoined(msg);
        break;
      case 'waiting':
        onWaiting(msg.reason);
        break;
      case 'lobby':
        renderLobby(msg.guests || []);
        break;
      case 'peer':
        createPeer({ polite: msg.polite, name: msg.peer?.name || '' });
        break;
      case 'peer-left':
        teardownPeer();
        setStatus('');
        setIdle(state.role === 'owner' ? TEXT.idleOwner : TEXT.idleGuestHostAway);
        break;
      case 'signal':
        state.peer?.handleSignal(msg.data);
        break;
      case 'denied':
        showEnded('Niet binnengelaten', 'De gastheer heeft je niet binnengelaten.', { canRejoin: false });
        break;
      case 'error': {
        if (msg.code === 'not-authorized') return (location.href = '/login');
        const [title, text] = TEXT.errors[msg.code] || ['Er ging iets mis', `Foutcode: ${msg.code}`];
        showEnded(title, text, { canRejoin: !['bad-link', 'no-room'].includes(msg.code) });
        break;
      }
    }
  });

  signal.addEventListener('reconnecting', () => {
    if (state.joined) setStatus('Verbinding met de server kwijt. Opnieuw verbinden…');
  });
}

function onJoined(msg) {
  state.joined = true;
  state.ice = msg.ice || [];
  state.roomName = msg.roomName || '';
  $('#room-name').textContent = state.roomName;
  updateTitle();
  if (msg.ticket) {
    try {
      sessionStorage.setItem(`wowround:ticket:${roomId}`, msg.ticket);
    } catch {
      /* geen opslag */
    }
  }

  $('#prejoin').hidden = true;
  previewBubble?.remove();
  previewBubble = null;
  controls.hidden = false;
  $('#btn-copy').hidden = state.role !== 'owner';

  if (!selfBubble) {
    selfBubble = new Bubble({ container: bubbles, key: `self:${layoutMode}`, name: state.name, mirror: true, muted: true });
    selfBubble.restoreOr(...DEFAULTS[layoutMode].self);
    refreshLocalVideo();
  }
  if (!state.peer) setIdle(state.role === 'owner' ? TEXT.idleOwner : '');
  setStatus('');
  fillDevices();
}

function onWaiting(reason) {
  if (state.joined) {
    if (reason === 'host-absent') {
      setIdle(TEXT.idleGuestHostAway);
      setStatus('');
    }
    return;
  }
  $('#prejoin-title').textContent = 'Even wachten';
  $('#prejoin-text').textContent = reason === 'host-absent' ? TEXT.waitingHost : TEXT.waitingAdmit;
  $('#prejoin-form').hidden = true;
}

// ——— Wachtruimte (eigenaar) ———

function renderLobby(guests) {
  const panel = $('#knock');
  if (guests.length > state.lobbyCount) ringDoorbell();
  state.lobbyCount = guests.length;
  updateTitle();
  panel.replaceChildren(
    ...guests.map((g) =>
      el(
        'div',
        { class: 'knock-row' },
        el('strong', { text: `${g.name} wil binnenkomen` }),
        el('button', {
          class: 'btn',
          type: 'button',
          text: 'Weigeren',
          onclick: () => state.signal.send({ t: 'deny', guestId: g.id }),
        }),
        el('button', {
          class: 'btn btn-primary',
          type: 'button',
          text: 'Binnenlaten',
          onclick: () => state.signal.send({ t: 'admit', guestId: g.id }),
        }),
      ),
    ),
  );
  if (guests.length && state.peer) {
    panel.append(el('p', { class: 'status', text: `Binnenlaten vervangt ${state.peerName || 'je huidige gast'}.` }));
  }
  panel.hidden = guests.length === 0;
}

// ——— Bediening ———

let fadeTimer;
function showControls() {
  controls.classList.remove('faded');
  scheduleFade();
}
function scheduleFade() {
  clearTimeout(fadeTimer);
  if (!stage.classList.contains('sharing')) return;
  fadeTimer = setTimeout(() => {
    if (!controls.matches(':focus-within') && $('#menu').hidden) controls.classList.add('faded');
  }, 3000);
}
document.addEventListener('pointermove', showControls);
controls.addEventListener('focusin', showControls);

$('#btn-mic').addEventListener('click', () => setMic(!state.micOn));
$('#btn-cam').addEventListener('click', () => setCam(!state.camOn));
$('#pre-mic').addEventListener('click', () => setMic(!state.micOn));
$('#pre-cam').addEventListener('click', () => setCam(!state.camOn));
$('#btn-share').addEventListener('click', () => (state.screenStream ? stopScreen(true) : startScreen()));
$('#btn-draw').addEventListener('click', () => setDraw(!annotator.drawing));
$('#btn-leave').addEventListener('click', () => showEnded('Je hebt opgehangen', 'De ruimte blijft bestaan. Je kunt altijd terugkomen.'));
$('#btn-rejoin').addEventListener('click', () => location.reload());

$('#btn-more').addEventListener('click', () => {
  const menu = $('#menu');
  menu.hidden = !menu.hidden;
  $('#btn-more').setAttribute('aria-expanded', String(!menu.hidden));
  if (!menu.hidden) fillDevices();
});

$('#btn-copy').addEventListener('click', async () => {
  try {
    const { rooms } = await api('GET', '/api/rooms');
    const room = rooms.find((r) => r.id === roomId);
    toast(room && (await copyText(room.guestUrl)) ? 'Gastlink gekopieerd' : 'Kopiëren lukte niet');
  } catch {
    toast('Kopiëren lukte niet');
  }
});

async function fillDevices() {
  if (!navigator.mediaDevices.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  for (const [selId, kind, track] of [
    ['sel-mic', 'audioinput', micTrack()],
    ['sel-cam', 'videoinput', camTrack()],
  ]) {
    const select = document.getElementById(selId);
    const current = track?.getSettings().deviceId;
    select.replaceChildren(
      ...devices
        .filter((d) => d.kind === kind)
        .map((d, i) => {
          const option = el('option', { value: d.deviceId, text: d.label || `Apparaat ${i + 1}` });
          if (d.deviceId === current) option.selected = true;
          return option;
        }),
    );
  }
}

$('#sel-mic').addEventListener('change', async (e) => {
  const deviceId = e.target.value;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints(deviceId) });
    const track = stream.getAudioTracks()[0];
    track.enabled = state.micOn;
    const old = micTrack();
    if (old) {
      old.stop();
      state.localStream.removeTrack(old);
    }
    state.localStream.addTrack(track);
    await state.peer?.replaceAudioTrack(track);
    store.set('devices', { ...store.get('devices', {}), mic: deviceId });
    refreshLocalVideo();
  } catch {
    toast('Deze microfoon is niet beschikbaar');
  }
});

$('#sel-cam').addEventListener('change', async (e) => {
  const deviceId = e.target.value;
  store.set('devices', { ...store.get('devices', {}), cam: deviceId });
  if (!state.camOn) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(deviceId) });
    const old = camTrack();
    if (old) {
      old.stop();
      state.localStream.removeTrack(old);
    }
    state.localStream.addTrack(stream.getVideoTracks()[0]);
    await state.peer?.replaceCameraTrack(camTrack());
    refreshLocalVideo();
  } catch {
    toast('Deze camera is niet beschikbaar');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!state.joined) return;
  const key = e.key.toLowerCase();
  if (key === 'm') setMic(!state.micOn);
  else if (key === 'v') setCam(!state.camOn);
  else if (key === 's') $('#btn-share').click();
  else if (key === 'd' && !screenWrap.hidden) setDraw(!annotator.drawing);
  else if (key === 'escape') {
    setDraw(false);
    $('#menu').hidden = true;
  }
});

window.addEventListener('pagehide', () => state.signal?.close());

// ——— Start ———

async function init() {
  let me = { owner: false };
  try {
    me = await api('GET', '/api/me');
  } catch {
    /* behandel als gast */
  }

  if (guestKey) state.role = 'guest';
  else if (me.owner) state.role = 'owner';
  else {
    showEnded('Deze link is onvolledig', 'Gebruik de volledige gastlink die je hebt gekregen, of log in als je de gastheer bent.', {
      canRejoin: false,
    });
    return;
  }

  $('#prejoin').hidden = false;
  const nameInput = $('#display-name');
  nameInput.value = store.get('name', '');
  if (state.role === 'owner') {
    $('#prejoin-title').textContent = 'Ruimte openen';
    $('#prejoin-text').textContent = 'Check je camera en microfoon. Je gast ziet je pas als je die binnenlaat.';
    $('#prejoin-submit').textContent = 'Ruimte openen';
  } else {
    $('#prejoin-text').textContent = 'Check je camera en microfoon. De gastheer laat je binnen.';
    $('#prejoin-submit').textContent = 'Vraag om binnen te komen';
  }

  const submit = $('#prejoin-submit');
  const submitLabel = submit.textContent;
  let mediaReady = false;

  // Het formulier direct afvangen, ook als de camera nog opstart.
  nameInput.addEventListener('input', () => previewBubble?.setName(nameInput.value || '?'));
  $('#prejoin-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!mediaReady) return;
    const name = nameInput.value.trim();
    if (!name) {
      $('#prejoin-error').textContent = 'Vul je naam in, zodat de ander weet wie je bent.';
      nameInput.focus();
      return;
    }
    state.name = name.slice(0, 40);
    store.set('name', state.name);
    $('#prejoin-error').textContent = '';
    submit.disabled = true;
    if (state.role === 'owner') primeDoorbell();
    connectSignal();
  });

  previewBubble = new Bubble({ container: $('#preview'), key: 'preview', name: nameInput.value || '?', mirror: true, muted: true, draggable: false });
  submit.disabled = true;
  submit.textContent = 'Camera en microfoon starten…';
  const ok = await startMedia();
  if (!ok) $('#prejoin-error').textContent = 'Geen toegang tot camera of microfoon. Je kunt meedoen zonder, of toegang geven in je browser.';
  refreshLocalVideo();
  reflectToggles();
  mediaReady = true;
  submit.disabled = false;
  submit.textContent = submitLabel;
}

init();
