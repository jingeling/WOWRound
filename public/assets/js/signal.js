// WebSocket-verbinding met de signaleringsserver, met automatisch opnieuw verbinden.
// Mediaverkeer loopt hier niet doorheen; alleen korte JSON-berichten.

const FINAL_CODES = new Set([4000, 4001, 4002, 4003, 4004]); // vervangen, verwijderd, geweigerd, link ingetrokken, ruimte weg

export class Signal extends EventTarget {
  constructor(joinMessage) {
    super();
    this.joinMessage = joinMessage;
    this.attempt = 0;
    this.stopped = false;
    this.connect();
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.attempt = 0;
      this.send(typeof this.joinMessage === 'function' ? this.joinMessage() : this.joinMessage);
      this.dispatchEvent(new CustomEvent('open'));
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this.dispatchEvent(new CustomEvent('message', { detail: msg }));
    });

    ws.addEventListener('close', (event) => {
      if (this.stopped) return;
      if (FINAL_CODES.has(event.code)) {
        this.stopped = true;
        this.dispatchEvent(new CustomEvent('final', { detail: event.code }));
        return;
      }
      // Opnieuw proberen met oplopende wachttijd, maximaal 15 seconden.
      const delay = Math.min(15_000, 500 * 2 ** this.attempt++);
      this.dispatchEvent(new CustomEvent('reconnecting', { detail: delay }));
      this.timer = setTimeout(() => this.connect(), delay);
    });
  }

  send(msg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.stopped = true;
    clearTimeout(this.timer);
    try {
      this.send({ t: 'leave' });
      this.ws?.close(1000);
    } catch {
      /* al dicht */
    }
  }
}
