// Zwevende bubbels: het hart van de interface (principe 1).
// Rond, versleepbaar, dubbelklik voor groter. Een ring laat zien wie er praat.

import { el, icon, initials, store } from './ui.js';

let audioContext;
function getAudioContext() {
  if (!audioContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioContext = new Ctx();
  }
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  return audioContext;
}

export class Bubble {
  constructor({ container, key, name, mirror = false, muted = false, draggable = true }) {
    this.container = container;
    this.key = key;
    this.video = el('video', { autoplay: true, playsinline: true });
    this.video.muted = muted;
    this.initialsEl = el('span', { class: 'initials', 'aria-hidden': 'true' });
    this.nameEl = el('span', { class: 'name' });
    const mutedIcon = el('span', { class: 'muted-icon', title: 'Microfoon uit' });
    mutedIcon.append(icon('i-mic-off'));

    this.root = el(
      'div',
      { class: `bubble${mirror ? ' mirror' : ''}`, tabindex: '0', role: 'group' },
      el('div', { class: 'face' }, this.video, this.initialsEl),
      mutedIcon,
      this.nameEl,
    );
    this.setName(name);
    container.append(this.root);
    if (draggable) this.enableDrag();
    this.root.addEventListener('dblclick', () => this.toggleSize());
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.toggleSize();
    });
  }

  setName(name) {
    this.name = name || '';
    this.nameEl.textContent = this.name;
    this.initialsEl.textContent = initials(this.name);
    this.root.setAttribute('aria-label', this.name);
  }

  setStream(stream) {
    if (this.video.srcObject !== stream) {
      this.video.srcObject = stream;
      this.video.play().catch(() => {
        // Autoplay geblokkeerd: bij de eerste klik alsnog afspelen.
        document.addEventListener('pointerdown', () => this.video.play().catch(() => {}), { once: true });
      });
    }
    this.watchVoice(stream);
  }

  setState({ mic, cam }) {
    if (mic !== undefined) this.root.classList.toggle('mic-off', !mic);
    if (cam !== undefined) this.root.classList.toggle('cam-off', !cam);
  }

  setWaiting(waiting) {
    this.root.classList.toggle('waiting', waiting);
  }

  toggleSize() {
    this.root.classList.toggle('big');
    this.clamp();
  }

  // Spraakdetectie met een simpele energiemeting op het geluid.
  watchVoice(stream) {
    this.stopVoice();
    const track = stream?.getAudioTracks()[0];
    const ctx = track && getAudioContext();
    if (!ctx) return;
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let speakingUntil = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const now = performance.now();
      if (rms > 0.035 && track.enabled && !this.root.classList.contains('mic-off')) speakingUntil = now + 300;
      this.root.classList.toggle('speaking', now < speakingUntil);
    };
    this.voiceTimer = setInterval(tick, 80);
    this.voiceNodes = [source, analyser];
  }

  stopVoice() {
    clearInterval(this.voiceTimer);
    this.voiceNodes?.forEach((n) => n.disconnect());
    this.voiceNodes = null;
    this.root.classList.remove('speaking');
  }

  // Positie als fractie van het venster, zodat het werkt bij elk formaat.
  placeAt(fx, fy) {
    this.pos = { fx, fy };
    this.apply();
  }

  restoreOr(fx, fy) {
    const saved = store.get(`bubble:${this.key}`);
    this.placeAt(saved?.fx ?? fx, saved?.fy ?? fy);
  }

  apply() {
    const bounds = this.container.getBoundingClientRect();
    const size = this.root.offsetWidth || 144;
    const margin = 12;
    const x = Math.min(Math.max(this.pos.fx * bounds.width - size / 2, margin), bounds.width - size - margin);
    const y = Math.min(Math.max(this.pos.fy * bounds.height - size / 2, margin + 40), bounds.height - size - margin - 80);
    this.root.style.transform = `translate(${x}px, ${y}px)`;
  }

  clamp() {
    requestAnimationFrame(() => this.pos && this.apply());
  }

  enableDrag() {
    let start = null;
    this.root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.root.setPointerCapture(e.pointerId);
      const rect = this.root.getBoundingClientRect();
      start = { dx: e.clientX - rect.left, dy: e.clientY - rect.top, moved: false };
      this.root.classList.add('dragging');
    });
    this.root.addEventListener('pointermove', (e) => {
      if (!start) return;
      start.moved = true;
      const bounds = this.container.getBoundingClientRect();
      const size = this.root.offsetWidth;
      const fx = (e.clientX - start.dx + size / 2 - bounds.left) / bounds.width;
      const fy = (e.clientY - start.dy + size / 2 - bounds.top) / bounds.height;
      this.placeAt(fx, fy);
    });
    const end = () => {
      if (!start) return;
      if (start.moved) store.set(`bubble:${this.key}`, this.pos);
      start = null;
      this.root.classList.remove('dragging');
    };
    this.root.addEventListener('pointerup', end);
    this.root.addEventListener('pointercancel', end);
  }

  remove() {
    this.stopVoice();
    this.video.srcObject = null;
    this.root.remove();
  }
}
