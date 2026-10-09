// Startpunt. Leest de configuratie, start de server en stopt netjes bij SIGTERM.

import { loadConfig } from './config.js';
import { createApp } from './app.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(`WOWRound start niet: ${err.message}`);
  process.exit(1);
}

const app = createApp(config);

app.server.listen(config.port, config.host, () => {
  console.log(`WOWRound luistert op http://${config.host}:${config.port} (publiek adres: ${config.origin})`);
  if (config.isDev) console.log('Ontwikkelmodus: niet gebruiken op het open internet.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
