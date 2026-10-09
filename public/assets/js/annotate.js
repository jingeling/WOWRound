// Aanwijzen en tekenen op het gedeelde scherm (principe 7).
//
// Coördinaten zijn fracties (0–1) van het gedeelde beeld, dus ze kloppen ongeacht
// de venstergrootte aan beide kanten. Wie deelt, ziet een voorbeeld van het eigen
// scherm met de aanwijzer van de ander erop. Een browser kan niet op je echte
// bureaublad tekenen; daarvoor is een native app nodig (bewust buiten scope).

const POINTER_COLOR = '#e9a01b';
const STROKE_FADE_MS = 4000;
const PING_MS = 900;

export class Annotator {
  constructor({ canvas, video, send }) {
    this.canvas = canvas;
    this.video = video;
    this.send = send;
    this.ctx = canvas.getContext('2d');
    this.remotePointer = null;
    this.remoteName = '';
    this.strokes = new Map(); // id → { points, color, doneAt }
    this.pings = [];
    this.drawing = false;
    this.current = null;
    this.lastSent = 0;
    this.active = false;

    this.onResize = () => this.layout();
    window.addEventListener('resize', this.onResize);
    video.addEventListener('loadedmetadata', this.onResize);
    video.addEventListener('resize', this.onResize);

    // Aanwijzer: bewegen boven het gedeelde beeld stuurt je positie mee.
    const stage = canvas.parentElement;
    stage.addEventListener('pointermove', (e) => this.onMove(e));
    stage.addEventListener('pointerleave', () => this.send({ t: 'pointer-out' }));
    stage.addEventListener('click', (e) => {
      if (this.drawing) return;
      const p = this.toFraction(e);
      if (p) {
        this.addPing(p, true);
        this.send({ t: 'ping', ...p });
      }
    });

    canvas.addEventListener('pointerdown', (e) => this.startStroke(e));
    canvas.addEventListener('pointermove', (e) => this.extendStroke(e));
    canvas.addEventListener('pointerup', () => this.endStroke());
    canvas.addEventListener('pointercancel', () => this.endStroke());

    this.loop = () => {
      this.render();
      this.raf = requestAnimationFrame(this.loop);
    };
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.layout();
    this.raf = requestAnimationFrame(this.loop);
  }

  stop() {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.strokes.clear();
    this.pings = [];
    this.remotePointer = null;
    this.setDrawing(false);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  setDrawing(on) {
    this.drawing = on;
    this.canvas.classList.toggle('drawing', on);
  }

  // Het canvas precies over het zichtbare beeld leggen (zonder zwarte randen).
  layout() {
    const box = this.video.getBoundingClientRect();
    const vw = this.video.videoWidth || 16;
    const vh = this.video.videoHeight || 9;
    const scale = Math.min(box.width / vw, box.height / vh);
    const w = vw * scale;
    const h = vh * scale;
    const left = (box.width - w) / 2;
    const top = (box.height - h) / 2;
    Object.assign(this.canvas.style, { left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px` });
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.rect = { left: box.left + left, top: box.top + top, width: w, height: h };
  }

  toFraction(e) {
    if (!this.rect) return null;
    const x = (e.clientX - this.rect.left) / this.rect.width;
    const y = (e.clientY - this.rect.top) / this.rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x: round(x), y: round(y) };
  }

  onMove(e) {
    if (!this.active) return;
    const now = performance.now();
    if (now - this.lastSent < 33) return; // ongeveer 30 keer per seconde
    this.lastSent = now;
    const p = this.toFraction(e);
    this.send(p ? { t: 'pointer', ...p } : { t: 'pointer-out' });
  }

  startStroke(e) {
    if (!this.drawing) return;
    const p = this.toFraction(e);
    if (!p) return;
    this.canvas.setPointerCapture(e.pointerId);
    const id = Math.random().toString(36).slice(2, 10);
    this.current = { id, points: [[p.x, p.y]], buffer: [] };
    this.strokes.set(`l:${id}`, { points: this.current.points, color: '#ffffff', doneAt: null });
    this.send({ t: 'stroke', id, points: [[p.x, p.y]] });
  }

  extendStroke(e) {
    if (!this.current) return;
    const p = this.toFraction(e);
    if (!p) return;
    this.current.points.push([p.x, p.y]);
    this.current.buffer.push([p.x, p.y]);
    if (this.current.buffer.length >= 4) this.flush();
  }

  flush(done = false) {
    if (!this.current) return;
    this.send({ t: 'stroke', id: this.current.id, points: this.current.buffer, done });
    this.current.buffer = [];
  }

  endStroke() {
    if (!this.current) return;
    this.flush(true);
    const s = this.strokes.get(`l:${this.current.id}`);
    if (s) s.doneAt = performance.now();
    this.current = null;
  }

  // Berichten van de ander.
  handle(msg) {
    switch (msg.t) {
      case 'pointer':
        if (valid(msg.x) && valid(msg.y)) this.remotePointer = { x: msg.x, y: msg.y, at: performance.now() };
        break;
      case 'pointer-out':
        this.remotePointer = null;
        break;
      case 'ping':
        if (valid(msg.x) && valid(msg.y)) this.addPing({ x: msg.x, y: msg.y }, false);
        break;
      case 'stroke': {
        if (typeof msg.id !== 'string' || !Array.isArray(msg.points) || msg.points.length > 64) return;
        const key = `r:${msg.id.slice(0, 16)}`;
        let s = this.strokes.get(key);
        if (!s) {
          if (this.strokes.size > 200) return;
          s = { points: [], color: POINTER_COLOR, doneAt: null };
          this.strokes.set(key, s);
        }
        for (const pt of msg.points) if (Array.isArray(pt) && valid(pt[0]) && valid(pt[1]) && s.points.length < 2000) s.points.push(pt);
        if (msg.done) s.doneAt = performance.now();
        break;
      }
      case 'clear':
        this.strokes.clear();
        break;
    }
  }

  addPing(p, local) {
    this.pings.push({ ...p, at: performance.now(), color: local ? '#ffffff' : POINTER_COLOR });
  }

  render() {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    const dpr = window.devicePixelRatio || 1;
    const now = performance.now();
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const [key, s] of this.strokes) {
      const age = s.doneAt ? now - s.doneAt : 0;
      if (age > STROKE_FADE_MS) {
        this.strokes.delete(key);
        continue;
      }
      if (s.points.length < 1) continue;
      ctx.globalAlpha = s.doneAt ? 1 - age / STROKE_FADE_MS : 1;
      // Donkere rand maakt de lijn zichtbaar op lichte én donkere schermen.
      for (const [color, width] of [['rgba(10,15,25,0.55)', 7], [s.color, 4]]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width * dpr;
        ctx.beginPath();
        s.points.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)));
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    this.pings = this.pings.filter((p) => now - p.at < PING_MS);
    for (const p of this.pings) {
      const t = (now - p.at) / PING_MS;
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 3 * dpr;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, (8 + 28 * t) * dpr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const rp = this.remotePointer;
    if (rp && now - rp.at < 5000) {
      const x = rp.x * w;
      const y = rp.y * h;
      ctx.fillStyle = POINTER_COLOR;
      ctx.strokeStyle = 'rgba(10,15,25,0.7)';
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 4 * dpr, y + 18 * dpr);
      ctx.lineTo(x + 8.5 * dpr, y + 12.5 * dpr);
      ctx.lineTo(x + 15 * dpr, y + 12 * dpr);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (this.remoteName) {
        ctx.font = `600 ${12 * dpr}px 'Instrument Sans', system-ui, sans-serif`;
        const tw = ctx.measureText(this.remoteName).width;
        const bx = x + 16 * dpr;
        const by = y + 16 * dpr;
        ctx.fillStyle = POINTER_COLOR;
        roundRect(ctx, bx, by, tw + 12 * dpr, 20 * dpr, 10 * dpr);
        ctx.fill();
        ctx.fillStyle = '#1d2430';
        ctx.fillText(this.remoteName, bx + 6 * dpr, by + 14 * dpr);
      }
    }
  }

  destroy() {
    this.stop();
    window.removeEventListener('resize', this.onResize);
  }
}

function round(n) {
  return Math.round(n * 10000) / 10000;
}

function valid(n) {
  return typeof n === 'number' && n >= 0 && n <= 1;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
