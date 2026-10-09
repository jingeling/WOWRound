// Eén rechtstreekse verbinding tussen twee browsers.
//
// Beeld en geluid gaan van browser naar browser, versleuteld met DTLS-SRTP
// (verplicht in WebRTC, niet uit te zetten). Het datakanaal voor aanwijzen en
// status is ook rechtstreeks en versleuteld (DTLS). De server ziet niets hiervan.
//
// Onderhandelen gebeurt volgens het "perfect negotiation"-patroon, zodat het
// niet uitmaakt wie later als eerste iets verandert. Het allereerste voorstel
// komt altijd van de eigenaar: de gast wacht daarop en hangt zijn camera en
// microfoon pas daarna aan de verbinding. Zo botsen de openingsvoorstellen nooit;
// zo'n botsing liet in tests af en toe een verbinding hangen.

const CAMERA_BITRATE = 450_000;
const SCREEN_BITRATE = 6_000_000;

export class Peer extends EventTarget {
  constructor({ iceServers, polite, sendSignal }) {
    super();
    this.polite = polite;
    this.sendSignal = sendSignal;
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.senders = { audio: null, camera: null, screen: null };
    this.remoteStreams = new Map();
    this.closed = false;
    // De eigenaar (niet beleefd) opent; de gast wacht op het eerste voorstel.
    this.opened = !polite;
    this.pending = [];

    this.pc = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require' });

    // Vooraf afgesproken kanaal: beide kanten maken het, geen extra onderhandeling nodig.
    this.dc = this.pc.createDataChannel('wowround', { negotiated: true, id: 0, ordered: true });
    this.dc.addEventListener('open', () => this.dispatchEvent(new CustomEvent('channel-open')));
    this.dc.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      this.dispatchEvent(new CustomEvent('data', { detail: msg }));
    });

    this.pc.addEventListener('negotiationneeded', async () => {
      if (!this.opened) return; // gast: eerst het voorstel van de eigenaar afwachten
      try {
        this.makingOffer = true;
        await this.pc.setLocalDescription();
        this.sendSignal({ description: this.pc.localDescription });
      } catch (err) {
        console.warn('Onderhandelen mislukt', err);
      } finally {
        this.makingOffer = false;
      }
    });

    this.pc.addEventListener('icecandidate', ({ candidate }) => {
      if (candidate) this.sendSignal({ candidate });
    });

    this.pc.addEventListener('track', ({ track, streams }) => {
      const stream = streams[0];
      if (!stream) return;
      this.remoteStreams.set(stream.id, stream);
      this.dispatchEvent(new CustomEvent('track', { detail: { track, stream } }));
    });

    this.pc.addEventListener('connectionstatechange', () => {
      const state = this.pc.connectionState;
      this.dispatchEvent(new CustomEvent('state', { detail: state }));
      // Bij een netwerkwissel (wifi naar 4G) opnieuw kandidaten zoeken.
      if (state === 'failed') this.pc.restartIce();
    });
  }

  async handleSignal({ description, candidate }) {
    if (this.closed) return;
    try {
      if (description) {
        const collision = description.type === 'offer' && (this.makingOffer || this.pc.signalingState !== 'stable');
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return;
        await this.pc.setRemoteDescription(description);
        if (description.type === 'offer' && !this.opened) {
          // Eerste voorstel binnen: nu pas eigen tracks toevoegen, zodat ze
          // meteen in het antwoord meegaan.
          this.opened = true;
          for (const fn of this.pending.splice(0)) fn();
        }
        if (description.type === 'offer') {
          await this.pc.setLocalDescription();
          this.sendSignal({ description: this.pc.localDescription });
        }
      } else if (candidate) {
        try {
          await this.pc.addIceCandidate(candidate);
        } catch (err) {
          if (!this.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.warn('Signaal verwerken mislukt', err);
    }
  }

  send(msg) {
    if (this.dc.readyState === 'open') this.dc.send(JSON.stringify(msg));
  }

  // Camera en microfoon toevoegen. De stream-ID reist mee, zodat de andere kant
  // camera en scherm uit elkaar kan houden.
  addCamera(stream) {
    if (!this.opened) return void this.pending.push(() => this.addCamera(stream));
    const audio = stream.getAudioTracks()[0];
    const video = stream.getVideoTracks()[0];
    if (audio) this.senders.audio = this.pc.addTrack(audio, stream);
    if (video) {
      this.senders.camera = this.pc.addTrack(video, stream);
      this.limit(this.senders.camera, CAMERA_BITRATE, 'balanced');
    } else {
      // Ook zonder camera een plek reserveren, zodat hem later aanzetten zonder hertelling kan.
      const transceiver = this.pc.addTransceiver('video', { direction: 'sendrecv', streams: [stream] });
      this.senders.camera = transceiver.sender;
    }
  }

  async replaceCameraTrack(track) {
    if (this.senders.camera) {
      await this.senders.camera.replaceTrack(track);
      if (track) this.limit(this.senders.camera, CAMERA_BITRATE, 'balanced');
    }
  }

  async replaceAudioTrack(track) {
    if (this.senders.audio) await this.senders.audio.replaceTrack(track);
  }

  // Schermdelen: scherpte gaat voor vloeiendheid (principe 6).
  addScreen(stream) {
    if (!this.opened) return void this.pending.push(() => this.addScreen(stream));
    const track = stream.getVideoTracks()[0];
    if (!track || track.readyState === 'ended') return; // al gestopt voordat de verbinding er was
    this.senders.screen = this.pc.addTrack(track, stream);
    const transceiver = this.pc.getTransceivers().find((t) => t.sender === this.senders.screen);
    preferCodecs(transceiver, ['video/VP9', 'video/AV1', 'video/H264', 'video/VP8']);
    this.limit(this.senders.screen, SCREEN_BITRATE, 'maintain-resolution');
  }

  removeScreen() {
    if (this.senders.screen && !this.closed) {
      try {
        this.pc.removeTrack(this.senders.screen);
      } catch {
        /* verbinding al dicht */
      }
    }
    this.senders.screen = null;
  }

  async limit(sender, maxBitrate, degradationPreference) {
    // setParameters kan pas werken nadat er onderhandeld is; daarom even wachten.
    const apply = async () => {
      const params = sender.getParameters();
      if (!params.encodings || !params.encodings.length) return false;
      params.encodings[0].maxBitrate = maxBitrate;
      if (degradationPreference) params.degradationPreference = degradationPreference;
      await sender.setParameters(params);
      return true;
    };
    for (let i = 0; i < 10 && !this.closed; i++) {
      try {
        if (await apply()) return;
      } catch {
        /* nog niet klaar */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  async stats() {
    const report = await this.pc.getStats();
    let route = 'onbekend';
    report.forEach((s) => {
      if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') {
        const local = report.get(s.localCandidateId);
        route = local?.candidateType === 'relay' ? 'via TURN' : 'rechtstreeks';
      }
    });
    return { route };
  }

  close() {
    this.closed = true;
    try {
      this.dc.close();
    } catch {
      /* al dicht */
    }
    this.pc.close();
  }
}

function preferCodecs(transceiver, order) {
  if (!transceiver?.setCodecPreferences || !window.RTCRtpReceiver?.getCapabilities) return;
  try {
    const codecs = RTCRtpReceiver.getCapabilities('video').codecs;
    const rank = (c) => {
      const i = order.indexOf(c.mimeType);
      return i === -1 ? order.length : i;
    };
    transceiver.setCodecPreferences([...codecs].sort((a, b) => rank(a) - rank(b)));
  } catch {
    /* browser kiest zelf */
  }
}
