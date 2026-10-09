// Maakt een willekeurig geheim voor APP_SECRET of TURN_SECRET.
import crypto from 'node:crypto';

console.log(crypto.randomBytes(48).toString('base64url'));
