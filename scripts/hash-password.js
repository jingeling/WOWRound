// Maakt een wachtwoord-hash voor OWNER_PASSWORD_HASH.
// Gebruik: npm run hash-password   (het wachtwoord wordt gevraagd, niet getoond)

import readline from 'node:readline';
import { hashPassword } from '../server/auth.js';

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const write = rl._writeToOutput.bind(rl);
  rl._writeToOutput = (s) => (s.includes(question) ? write(s) : write(''));
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  process.stdout.write('\n');
  return answer;
}

let password = process.env.WOWROUND_PASSWORD;
if (!password) {
  password = await ask('Kies een wachtwoord (minstens 12 tekens): ');
  const again = await ask('Nog een keer: ');
  if (password !== again) {
    console.error('De wachtwoorden zijn niet gelijk.');
    process.exit(1);
  }
}
if (password.length < 12) {
  console.error('Gebruik minstens 12 tekens. Een zin van vier losse woorden werkt goed.');
  process.exit(1);
}

console.log('\nZet deze regel in je .env:\n');
console.log(`OWNER_PASSWORD_HASH=${hashPassword(password)}`);
