// ICE-configuratie voor de browsers.
//
// Standaard alleen STUN: de browsers vinden elkaar en praten daarna rechtstreeks.
// Een TURN-server is optioneel (principe 13). Als je er een draait, krijgen alleen
// toegelaten deelnemers kortlevende inloggegevens volgens de coturn-methode
// "use-auth-secret": gebruikersnaam = verloopmoment, wachtwoord = HMAC van die naam.

import crypto from 'node:crypto';

export function iceServers(config, label = 'wowround') {
  const servers = [];
  if (config.stunUrls.length) servers.push({ urls: config.stunUrls });

  if (config.turnUrls.length && config.turnSecret) {
    const expiresAt = Math.floor(Date.now() / 1000) + config.turnTtlSeconds;
    const username = `${expiresAt}:${label}`;
    const credential = crypto.createHmac('sha1', config.turnSecret).update(username).digest('base64');
    servers.push({ urls: config.turnUrls, username, credential });
  }

  return servers;
}
