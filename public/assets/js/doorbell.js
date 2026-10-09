// Deurbel voor de wachtruimte: een klassiek "ding-dong" dat klinkt als er iemand aanklopt.
//
// Het geluid wordt in de browser opgewekt (Web Audio), er is geen geluidsbestand.
// Browsers spelen pas geluid af na een klik op de pagina; daarom zetten we het
// geluid alvast klaar op het moment dat de eigenaar op "Ruimte openen" klikt.
// Daarna klinkt de bel ook als het tabblad op de achtergrond staat.

let ctx = null;

export function primeDoorbell() {
  try {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    ctx = null;
  }
}

// Eén belslag: grondtoon plus zachte boventonen, snel aan en langzaam uitklinkend.
function strike(frequency, at, volume) {
  const partials = [
    [1, 1],
    [2, 0.35],
    [3, 0.12],
    [4.2, 0.05],
  ];
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, at);
  master.gain.exponentialRampToValueAtTime(volume, at + 0.01);
  master.gain.exponentialRampToValueAtTime(0.0001, at + 1.6);
  master.connect(ctx.destination);

  for (const [ratio, level] of partials) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frequency * ratio;
    gain.gain.value = level;
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + 1.7);
  }
}

export function ringDoorbell() {
  if (!ctx) primeDoorbell();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume();
  const now = ctx.currentTime + 0.05;
  strike(659.25, now, 0.22); // ding (E5)
  strike(523.25, now + 0.55, 0.22); // dong (C5)
}
