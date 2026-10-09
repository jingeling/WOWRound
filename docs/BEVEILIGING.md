# Beveiliging

WOWRound is gebouwd voor eigen gebruik. Er is geen certificering nodig, maar het ontwerp volgt bestaande standaarden: de WebRTC-beveiligingsarchitectuur van de IETF (RFC 8827), de communicatieprincipes van het Britse NCSC en OWASP ASVS niveau 1 voor het webgedeelte.

Gebruik je WOWRound voor werkgesprekken met anderen, dan geldt de AVG voor wat er wordt opgeslagen. Dat is bewust zo weinig mogelijk.

## Wat wie kan zien

| Partij | Ziet | Ziet niet |
| --- | --- | --- |
| Jij en je gast | Elkaars beeld, geluid, scherm, aanwijzer | — |
| Je WOWRound-server | Dat er iemand in een ruimte zit, de gastnaam tijdens het gesprek, IP-adressen, verbindingsvoorstellen (SDP) | Beeld, geluid, scherm, aanwijzingen, tekeningen |
| STUN-server | Je IP-adres, op het moment van verbinden | Alles daarna |
| TURN-server (optioneel) | IP-adressen, hoeveel data er gaat | De inhoud: die is versleuteld |
| Wie je netwerk afluistert | Dat je met iemand belt | De inhoud: TLS voor de server, DTLS-SRTP voor de media |

Beeld en geluid zijn versleuteld met DTLS-SRTP. Dat is verplicht in WebRTC en kan niet uit. Omdat er geen mediaserver tussen zit, is dat voor twee personen in de praktijk end-to-end. Er is dus geen extra laag zoals SFrame nodig; die is bedoeld voor opstellingen mét mediaserver.

Eén kanttekening: de vingerafdrukken van de versleuteling worden uitgewisseld via je eigen server. Een server die je zelf beheert is daarmee de partij die je vertrouwt. Wie de server overneemt, zou in theorie zichzelf ertussen kunnen zetten. Houd de server daarom goed bij (zie de checklist).

## Maatregelen in de code

**Toegang**
- Eén eigenaar met een wachtwoord, gehasht met scrypt (N=2¹⁵). Vergelijking in constante tijd.
- Maximaal 5 inlogpogingen per IP-adres per kwartier. Mislukte pogingen worden gelogd.
- Sessiecookie: willekeurig (256 bit), `HttpOnly`, `SameSite=Strict`, `Secure` en het voorvoegsel `__Host-` bij https. Verloopt na 7 dagen (instelbaar). Sessies staan alleen in het geheugen. Met "Overal uitloggen" vervallen alle sessies direct, bijvoorbeeld als je laptop kwijt is.
- Gastlinks zijn HMAC-SHA256-handtekeningen van ruimte en versie (192 bit). Ze worden niet opgeslagen maar nagerekend. Een nieuwe link maken trekt de oude direct in en zet wie binnen is eruit.
- De sleutel staat in de link achter het `#`. Browsers sturen dat deel niet naar de server, dus het komt niet in logs van proxies.
- Gasten komen in een wachtruimte (maximaal 5 wachtenden). Alleen de eigenaar laat binnen. Signalen van niet-toegelaten gasten worden genegeerd.

**Web**
- Content-Security-Policy: alleen eigen scripts, stijlen en lettertypen. Geen externe bronnen, geen inline code, geen frames.
- HSTS, `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, `Permissions-Policy` beperkt tot camera, microfoon en schermdelen.
- Elke wijziging (POST, PATCH, DELETE) en elke WebSocket moet van je eigen domein komen (controle op `Origin`).
- Namen van gasten gaan altijd als tekst de pagina in (`textContent`), nooit als HTML.
- Verzoeken zijn begrensd: 4 KB per API-verzoek, 64 KB per WebSocket-bericht, 300 berichten per 10 seconden per verbinding.

**Data**
- Geen opnames. Geen chatgeschiedenis.
- `data/rooms.json` bevat alleen ruimte-ID, naam, versie van de gastlink en aanmaakdatum. Bestandsrechten 600.

## De TURN-server

Je hebt waarschijnlijk geen TURN-server nodig. Die is alleen nodig als een rechtstreekse verbinding niet lukt, bijvoorbeeld achter een strenge bedrijfsfirewall. WOWRound laat in de statusregel zien of een verbinding rechtstreeks loopt of via TURN.

Draai je er toch een, weet dan dat TURN-servers een geliefd doelwit zijn. Beveiligingsbedrijf Enable Security beschreef in 2026 drie soorten misbruik: je server als doorgeefluik naar interne systemen, je server inzetten om anderen plat te leggen, en gewone softwarelekken. coturn 4.9.0 dichtte een lek waarmee de blokkeerregels te omzeilen waren (CVE-2026-27624).

`deploy/turnserver.conf.example` volgt hun richtlijnen:
- Kortlevende inloggegevens via een gedeeld geheim (`use-auth-secret`). Alleen toegelaten deelnemers krijgen ze.
- Doorsturen naar interne en speciale adresbereiken is geblokkeerd, ook via IPv4-in-IPv6.
- TCP-relay staat uit; WebRTC heeft alleen UDP nodig.
- Geen beheerinterface, quota per gebruiker.

Draai de TURN-server op een aparte server en houd coturn up-to-date.

**Alleen STUN, zonder Google of andere big tech:** coturn kan ook alleen als STUN-server draaien. Zet daarvoor in de configuratie `stun-only` en vul je eigen adres in bij `STUN_URLS`. Een STUN-server stuurt geen verkeer door en is daarmee veel minder gevoelig voor misbruik.

## Checklist

Loop deze lijst na bij installatie en daarna elk kwartaal.

- [ ] `PUBLIC_URL` begint met `https://`.
- [ ] `APP_SECRET` is minstens 32 tekens en staat alleen in `.env`.
- [ ] `.env` heeft rechten 640 en is van root:wowround.
- [ ] Je wachtwoord is minstens 12 tekens en nergens anders in gebruik.
- [ ] De server luistert op 127.0.0.1; poort 3000 is niet van buitenaf bereikbaar.
- [ ] SSH alleen met sleutels; inloggen met wachtwoorden staat uit.
- [ ] Automatische beveiligingsupdates staan aan.
- [ ] Node.js is een ondersteunde versie (22 of nieuwer).
- [ ] `npm audit --omit=dev` geeft geen bekende lekken.
- [ ] Caddy schrijft geen toegangslogs.
- [ ] Draai je TURN: coturn 4.9.0 of nieuwer, aparte server, configuratie volgens het voorbeeld.
- [ ] Gastlinks die je niet meer gebruikt, zijn vervangen of de ruimte is verwijderd.

## Een lek melden

Gevonden wat niet klopt? Maak geen openbaar issue aan, maar neem rechtstreeks contact op met de eigenaar van deze repository.

## Bronnen

- RFC 8827, WebRTC Security Architecture (IETF, 2021)
- RFC 9605, Secure Frame (SFrame) (IETF, 2024)
- NCSC, Secure communication principles
- OWASP Application Security Verification Standard
- Enable Security, TURN Security Threats, TURN Security Best Practices en Securing coturn (2026)
- La Suite Meet, beveiligingsdocumentatie
