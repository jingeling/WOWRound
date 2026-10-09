# Ontwerpprincipes

Deze principes komen uit onderzoek naar Around (de app die in maart 2025 stopte), tools voor samenwerken zoals Tuple en Pop, en beveiligingsstandaarden voor WebRTC. Per principe staat erbij hoe het in WOWRound terugkomt, zodat je bij elke wijziging kunt checken of je er nog aan voldoet.

## Ervaring

**1. Het werk staat centraal, niet de gezichten.**
Ronde zwevende bubbels in plaats van een raster. Bij schermdelen krimpen ze en schuiven ze naar de rand; het gedeelde venster vult het scherm.
→ `public/assets/js/bubbles.js`, `.stage.sharing` in `app.css`

**2. Zo weinig mogelijk knoppen.**
De balk heeft microfoon, camera, delen, tekenen (alleen zichtbaar tijdens delen), een menu en ophangen. Apparaatkeuze en de gastlink zitten achter het menu. Tijdens delen verdwijnt de balk na drie seconden stilstand.
→ `room.html`, `scheduleFade()` in `room.js`

**3. Bellen moet zo makkelijk zijn als iemand op de schouder tikken.**
Vaste ruimtes met een vaste gastlink. Geen agenda-uitnodigingen. Een gast die de pagina herlaadt, komt binnen tien minuten zonder opnieuw aankloppen terug.
→ `server/rooms.js`, tickets in `server/signaling.js`

**4. Gasten hoeven niets te installeren.**
Alles werkt in de browser. Gasten hebben geen account; alleen een naam.

**5. Audio gaat voor video.**
Echo-onderdrukking, ruisonderdrukking en automatische versterking staan altijd aan. De camera krijgt een lage bitrate (450 kbit/s), zodat er ruimte blijft voor geluid en scherm.
→ `audioConstraints()` in `room.js`, `CAMERA_BITRATE` in `peer.js`

## Samenwerken

**6. Scherpte gaat voor alles op het scherm.**
Het gedeelde scherm krijgt tot 6 Mbit/s en tot 4K. De track krijgt `contentHint = 'detail'` en de verbinding `degradationPreference = 'maintain-resolution'`: bij weinig bandbreedte zakt de beeldsnelheid, niet de scherpte. VP9 heeft de voorkeur omdat die tekst beter comprimeert.
→ `addScreen()` in `peer.js`, `startScreen()` in `room.js`

**7. Allebei kunnen sturen.**
Beide deelnemers zien elkaars aanwijzer op het gedeelde scherm, kunnen een markering plaatsen en kunnen tekenen. Wie deelt, ziet de aanwijzer van de ander op het eigen voorbeeld. Echt toetsenbord en muis delen kan niet vanuit een browser; dat is bewust buiten scope gelaten (zie principe 18).
→ `public/assets/js/annotate.js`

**8. Deel een venster, niet je hele bureaublad.**
De browser stelt standaard een venster voor (`displaySurface: 'window'`) en sluit het eigen tabblad uit. Je hele scherm delen kan nog, als bewuste keuze.

**9. Ontworpen voor twee, niet voor twintig.**
Precies één eigenaar en één gast per ruimte. Daardoor kan het peer-to-peer en is er geen mediaserver nodig.

## Beveiliging

**10. Privé vanaf het ontwerp.**
Beeld, geluid en het datakanaal gaan rechtstreeks tussen de browsers, versleuteld met DTLS-SRTP (RFC 8827). De server ziet nooit media. Is er een TURN-server nodig, dan stuurt die alleen versleutelde pakketten door en kan hij ook niet meekijken.
→ `server/signaling.js` geeft alleen SDP en ICE door

**11. Standaard dicht.**
Alleen de ingelogde eigenaar kan een ruimte openen. Gasten met een geldige link komen in een wachtruimte; de eigenaar laat ze binnen of weigert ze. Signalen van gasten die nog niet zijn toegelaten worden genegeerd.
→ `handleJoin()` en `handleSignal()` in `server/signaling.js`

**12. Kortlevende toegang.**
Sessies leven in het geheugen en verlopen na 7 dagen (instelbaar). Dat is een bewuste keuze voor gemak; als tegenwicht logt "Overal uitloggen" direct alle apparaten uit, en een herstart doet hetzelfde. Gastlinks zijn te vervangen met één klik; de oude werkt dan direct niet meer en wie binnen is, wordt eruit gezet. TURN-inloggegevens verlopen na een uur. Geheimen staan in `.env`, nooit in de code.
→ `server/auth.js`, `rotateKey()` in `server/rooms.js`, `server/ice.js`

**13. Houd je aanvalsoppervlak klein.**
Eén afhankelijkheid in productie (`ws`). Geen TURN-server tenzij nodig; als je er een draait, staat er een afgeschermde configuratie in `deploy/turnserver.conf.example`. De server luistert alleen op 127.0.0.1 achter Caddy.

**14. Bewaar zo weinig mogelijk.**
Er wordt niets opgenomen. `data/rooms.json` bevat alleen ruimtenamen en datums; geen gastnamen, geen gesprekken. De server logt alleen mislukte inlogpogingen. De voorbeeldconfiguratie van Caddy schrijft geen toegangslogs.

**15. Wees eerlijk over wat er zichtbaar blijft.**
De server weet wie er op welk moment in welke ruimte zit, en de gastnaam tijdens het gesprek. Dat staat in het geheugen en verdwijnt bij ophangen of herstart. STUN- en TURN-servers zien IP-adressen. Zie `docs/BEVEILIGING.md`.

## Architectuur en onderhoud

**16. Bouw niet zelf wat al bewezen is.**
De media-afhandeling is gewoon WebRTC uit de browser. De server gebruikt de Node-standaardbibliotheek plus `ws`. Geen zelfbedachte cryptografie: scrypt voor wachtwoorden, HMAC-SHA256 voor gastlinks.

**17. Saai is veilig.**
TLS via Caddy, HSTS, strikte Content-Security-Policy zonder externe bronnen, SameSite=Strict-cookies, controle op herkomst bij elke wijziging en elke WebSocket.
→ `server/security.js`

**18. Onderhoudbaar voor één persoon.**
Zo'n 3.000 regels code (inclusief opmaak en commentaar), geen buildstap, geen framework, geen database. Alle instellingen in één `.env`. Liever een functie minder (zoals besturing op afstand of groepsgesprekken) dan een systeem dat je niet kunt bijhouden.

**19. Leg het ernaast.**
Toets je opzet periodiek aan de NCSC-principes voor veilige communicatie, OWASP ASVS niveau 1 en de beveiligingsdocumentatie van La Suite Meet. De checklist in `docs/BEVEILIGING.md` helpt daarbij.
