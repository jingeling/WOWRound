# Keuzes

Dit logboek legt vast welke keuzes er voor WOWRound zijn gemaakt en waarom. Zo weet je later nog waarom iets zo is, en kun je een keuze bewust terugdraaien als de situatie verandert.

Per keuze staat wat er gekozen is, welke alternatieven er waren en wat de afweging was.

## Gemaakt op 9 oktober 2026

### 1. Mediaverkeer: rechtstreeks tussen de browsers

**Gekozen:** peer-to-peer. Beeld en geluid gaan rechtstreeks van browser naar browser; de server stelt ze alleen aan elkaar voor.

**Alternatief:** een mediaserver zoals LiveKit, met extra end-to-end-versleuteling (SFrame).

**Waarom:** voor precies twee mensen is peer-to-peer simpeler en privéer. Er draait geen mediaserver, en de server kan nooit meekijken. De versleuteling (DTLS-SRTP) is verplicht in WebRTC en loopt in de praktijk van browser tot browser.

### 2. Server: de bestaande webhosting bij Antagonist, als dat kan

**Gekozen:** WOWRound naast de bestaande website draaien bij Antagonist B.V.

**Alternatieven:** een losse kleine huurserver (VPS) bij een Europees bedrijf, of een server thuis.

**Waarom:** geen extra kosten of nieuw account. Voorwaarde: Antagonist moet Node.js 22, WebSockets en een altijd draaiende app ondersteunen. Daarover is op 9 oktober een mail gestuurd. Hun website noemt alleen Node.js 16, 18 en 20, die geen beveiligingsupdates meer krijgen, en de helpdesk biedt geen hulp bij Node.js-apps.

**Terugvaloptie:** is het antwoord nee of twijfelachtig, dan wordt het een losse VPS. De installatiestappen in de README zijn daarop afgestemd.

### 3. Webadres: wowround.jouwwebsite.nl

**Gekozen:** een subdomein `wowround` van het bestaande domein.

**Alternatief:** een nieuw eigen domein.

**Waarom:** gratis, snel geregeld, en gasten herkennen dat het van jou is. Nadeel waarmee rekening is gehouden: zeg je het hoofddomein ooit op, dan stoppen ook alle gastlinks.

### 4. Repository: openbaar

**Gekozen:** openbaar op GitHub.

**Alternatief:** privé.

**Waarom:** anderen kunnen het gebruiken en ervan leren, het past bij onafhankelijk zijn van big tech, en de code ophalen op de server is eenvoudig. De beveiliging hangt af van de geheimen in `.env`, en die staan nooit in GitHub.

**Bijbehorende maatregel:** commits staan op naam van het anonieme GitHub-adres in plaats van het persoonlijke e-mailadres. De eerste commit is daarvoor herschreven.

### 5. Gasten: altijd aankloppen, met een deurbel

**Gekozen:** elke gast komt in de wachtruimte, en de eigenaar laat binnen of weigert. Bij aankloppen klinkt een deurbel ("ding-dong"), ook als het tabblad op de achtergrond staat.

**Alternatief:** vertrouwde gasten direct binnenlaten.

**Waarom:** ook als een gastlink per ongeluk rondgaat, komt niemand ongevraagd binnen. Eén klik is weinig moeite voor die zekerheid. De deurbel zorgt dat je een wachtende gast niet mist.

### 6. Eigenaren: alleen jij

**Gekozen:** één eigenaar met één wachtwoord.

**Alternatief:** meerdere eigenaren met eigen logins, bijvoorbeeld via Keycloak.

**Waarom:** simpel, met weinig om te beveiligen. Uitbreiden kan later nog.

### 7. Ingelogd blijven: 7 dagen

**Gekozen:** sessies verlopen na 7 dagen (`SESSION_TTL_HOURS=168`).

**Alternatieven:** 12 uur (de oorspronkelijke standaard) of 4 uur.

**Waarom:** bijna nooit hoeven inloggen; het voelt als een app die klaarstaat.

**Bijbehorende maatregel:** de knop "Overal uitloggen" maakt alle sessies op alle apparaten direct ongeldig, bijvoorbeeld als je laptop kwijt is. Een ingelogde vreemde kan trouwens nooit meekijken in gesprekken; wel ruimtes openen en gastlinks zien.

### 8. Groepsgesprekken: nee

**Gekozen:** precies twee mensen per gesprek.

**Alternatief:** kleine groepen tot zes mensen.

**Waarom:** groepsgesprekken vragen een mediaserver, die zwaar is en in principe kan meekijken. Dat staat haaks op keuze 1 en past niet op gedeelde hosting. Voor groepen is een bestaande Europese tool zoals Jitsi of Whereby beter.

### 9. Besturing op afstand: nee

**Gekozen:** alleen aanwijzen, markeren en tekenen op het gedeelde scherm.

**Alternatieven:** een eigen app voor Mac en Windows die muis en toetsenbord deelt (zoals Tuple), of een gedeelde editor naast WOWRound.

**Waarom:** gasten installeren niets en er komt geen groot beveiligingsrisico bij. Een app die je computer op afstand mag besturen geeft bij een fout een vreemde toegang tot je hele computer. Wie echt samen wil typen, kan een gedeelde editor naast WOWRound gebruiken, zoals VS Code Live Share, Nextcloud of CryptPad.

## Nog open

Deze keuzes hangen af van het antwoord van Antagonist (keuze 2):

- **STUN-server:** de publieke server van Nextcloud (de huidige instelling) of een eigen. Een eigen STUN-server kan niet op gedeelde hosting.
- **TURN-server:** niet, of wel voor lastige netwerken. Kan ook niet op gedeelde hosting.
- **Bijhouden van de server:** handmatig bijwerken of automatisch. Op gedeelde hosting doet de hoster het meeste.

## Een keuze wijzigen

Verandert er iets, voeg dan een nieuw kopje toe met de datum, in plaats van een oude keuze te overschrijven. Zo blijft zichtbaar hoe het project zich heeft ontwikkeld.
