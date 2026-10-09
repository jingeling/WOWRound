# WOWRound

Zelf gehoste video voor 1-op-1 samenwerken op afstand. Geïnspireerd op Around (2020–2025): zwevende ronde gezichten in plaats van een raster, scherp schermdelen en zo min mogelijk knoppen.

Gebouwd voor eigen gebruik, niet als commercieel product.

- **Zwevende bubbels.** Versleep ze, dubbelklik om ze groter te maken. Een ring laat zien wie er praat.
- **Rechtstreeks van browser naar browser.** Beeld, geluid en aanwijzingen gaan niet via je server. De server stelt de twee browsers alleen aan elkaar voor.
- **Scherp schermdelen.** Een venster delen is de standaard. De verbinding kiest voor scherpe tekst boven vloeiende beweging.
- **Samen aanwijzen.** Beweeg over het gedeelde scherm en de ander ziet je aanwijzer met je naam. Klik voor een pulserende markering, of druk op D om te tekenen. Lijnen vervagen na vier seconden.
- **Vaste ruimtes.** Eén ruimte per persoon met wie je samenwerkt, met een vaste gastlink. Gasten installeren niets en hebben geen account nodig.
- **Standaard dicht.** Alleen jij kunt een ruimte openen. Gasten wachten in een wachtruimte tot jij ze binnenlaat. Klopt er iemand aan, dan klinkt er een deurbel, ook als het tabblad op de achtergrond staat.

De ontwerpprincipes en hoe elk principe in de code terugkomt staan in [docs/PRINCIPES.md](docs/PRINCIPES.md). Het beveiligingsmodel staat in [docs/BEVEILIGING.md](docs/BEVEILIGING.md). Welke keuzes er zijn gemaakt en waarom, staat in [docs/KEUZES.md](docs/KEUZES.md).

## Lokaal uitproberen

Je hebt Node.js 22 of nieuwer nodig.

```bash
npm install
cp .env.example .env
npm run gen-secret        # zet de uitkomst achter APP_SECRET= in .env
npm run hash-password     # zet de regel OWNER_PASSWORD_HASH=... in .env
```

Zet in `.env` voor lokaal gebruik `PUBLIC_URL=http://localhost:3000` en start in ontwikkelmodus:

```bash
npm run dev
```

Open http://localhost:3000, log in, maak een ruimte en open de gastlink in een tweede browser (of een privévenster).

## Op je eigen server zetten

Een kleine VPS is genoeg: de server verwerkt geen video. Hieronder Debian of Ubuntu met Caddy als reverse proxy.

1. **Server voorbereiden.** Log in met een SSH-sleutel en zet inloggen met een wachtwoord uit (`PasswordAuthentication no` in `/etc/ssh/sshd_config`). Zet automatische updates aan met `sudo apt install unattended-upgrades`.

2. **Node.js 22 en Caddy installeren.** Volg de officiële instructies op nodejs.org en caddyserver.com.

3. **WOWRound neerzetten.**
   ```bash
   sudo useradd --system --home /opt/wowround --shell /usr/sbin/nologin wowround
   sudo git clone https://github.com/jingeling/WOWRound /opt/wowround
   cd /opt/wowround
   sudo npm ci --omit=dev
   sudo cp .env.example .env && sudo nano .env      # vul PUBLIC_URL, APP_SECRET en OWNER_PASSWORD_HASH in
   sudo mkdir -p data && sudo chown -R wowround:wowround data
   sudo chown root:wowround .env && sudo chmod 640 .env
   ```

4. **Als service draaien.**
   ```bash
   sudo cp deploy/wowround.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now wowround
   ```

5. **Caddy instellen.** Zet de inhoud van `deploy/Caddyfile` in `/etc/caddy/Caddyfile`, vervang het domein en herlaad met `sudo systemctl reload caddy`. Caddy haalt zelf een certificaat op.

6. **Firewall.** Alleen poort 22 (SSH), 80 en 443 open. Poort 3000 blijft dicht; WOWRound luistert alleen op 127.0.0.1.

**Bijwerken:** `cd /opt/wowround && sudo git pull && sudo npm ci --omit=dev && sudo systemctl restart wowround`.

## Instellingen

Alle instellingen staan in `.env`. Zie `.env.example` voor uitleg per regel.

| Instelling | Wat het doet |
| --- | --- |
| `PUBLIC_URL` | Het publieke adres. Buiten ontwikkelmodus verplicht https. |
| `APP_SECRET` | Ondertekent gastlinks. Vervangen maakt alle gastlinks ongeldig. |
| `OWNER_PASSWORD_HASH` | Je wachtwoord, gehasht met scrypt. |
| `TRUST_PROXY` | `true` achter Caddy of nginx. |
| `STUN_URLS` | Server(s) om elkaar te vinden achter een router. |
| `TURN_URLS`, `TURN_SECRET` | Optioneel, voor als rechtstreeks verbinden niet lukt. |

## Bediening

| Toets | Actie |
| --- | --- |
| M | Microfoon aan of uit |
| V | Camera aan of uit (echt uit: het cameralampje gaat uit) |
| S | Venster delen of stoppen |
| D | Tekenen op het gedeelde scherm |
| Esc | Stoppen met tekenen, menu sluiten |

## Testen

```bash
npm test                  # server, inloggen, gastlinks, wachtruimte en signalering
npm run test:e2e          # twee echte browsers: verbinden, delen, aanwijzen, ophangen
```

Voor de browsertest heb je Chromium voor Playwright nodig: `npx playwright install chromium`.

## Wat het (bewust) niet doet

- **Geen groepsgesprekken.** Precies twee mensen. Daardoor kan het peer-to-peer zonder mediaserver.
- **Geen besturing van elkaars computer.** Een browser kan niet op je echte bureaublad klikken of tekenen. Wie deelt, ziet de aanwijzer van de ander op het eigen voorbeeld in WOWRound. Voor echt overnemen van toetsenbord en muis heb je een native app nodig zoals Tuple.
- **Geen opnames, geen chatgeschiedenis, geen accounts voor gasten.**

## Licentie

MIT. Het lettertype Instrument Sans valt onder de SIL Open Font License (`public/assets/fonts/OFL.txt`).
