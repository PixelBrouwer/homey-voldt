'use strict';

const net = require('node:net');
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const { COMMANDS: C, MAX_FRAME_LENGTH, keyBytes, versionString, readHeader, encodePacket, decodePacket, deriveSessionKey } = require('./tuya-lan-codec');

function replyTimeout() {
  return Object.assign(new Error('Geen bevestigd antwoord van de kabel ontvangen.'), { code: 'TUYA_LAN_TIMEOUT' });
}

class Session {
  constructor(options) {
    Object.assign(this, options);
    this.key = Buffer.from(this.localKey);
    this.sequence = 0;
    this.buffer = Buffer.alloc(0);
    this.frames = [];
    this.waiters = [];
    this.failure = null;
    this.intentionalClose = false;
  }

  async open() {
    this.socket = new net.Socket();
    this.socket.setNoDelay(true);
    this.socket.on('data', chunk => {
      try {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        if (this.buffer.length > MAX_FRAME_LENGTH * 2) throw new Error('Tuya LAN-ontvangstbuffer te groot.');
        while (true) {
          const header = readHeader(this.buffer);
          if (!header || this.buffer.length < header.totalLength) break;
          const frame = this.buffer.subarray(0, header.totalLength);
          this.buffer = this.buffer.subarray(header.totalLength);
          const waiter = this.waiters.shift();
          if (waiter) { clearTimeout(waiter.timer); waiter.resolve(frame); }
          else {
            if (this.frames.length >= 32) throw new Error('Te veel onverwachte Tuya LAN-pakketten.');
            this.frames.push(frame);
          }
        }
      } catch (error) { this.fail(error); this.socket.destroy(); }
    });
    this.socket.on('error', () => this.fail(new Error('Lokale verbinding met de kabel mislukt.')));
    this.socket.on('close', () => {
      if (!this.intentionalClose) this.fail(Object.assign(new Error('De kabel heeft de lokale verbinding gesloten.'), { code: 'TUYA_LAN_CLOSED' }));
    });
    await new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer);
        this.socket.removeListener('connect', connected);
        this.socket.removeListener('error', failed);
        error ? reject(error) : resolve();
      };
      const connected = () => finish();
      const failed = () => finish(new Error('Lokale verbinding met de kabel mislukt.'));
      const timer = setTimeout(() => { finish(new Error('Lokale verbinding met de kabel verlopen.')); this.socket.destroy(); }, this.timeoutMs);
      this.socket.once('connect', connected);
      this.socket.once('error', failed);
      this.socket.connect(this.port, this.host);
    });
    if (this.version !== '3.3') await this.negotiate();
  }

  fail(error) {
    this.failure = this.failure || error;
    for (const waiter of this.waiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(this.failure); }
  }

  nextFrame(timeoutMs) {
    if (this.frames.length) return Promise.resolve(this.frames.shift());
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      waiter.timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(replyTimeout());
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  async receiveUntil(predicate, timeoutMs = this.timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    for (let count = 0; count < 32; count++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw replyTimeout();
      const raw = await this.nextFrame(remaining);
      const packet = decodePacket(raw, { version: this.version, key: this.key });
      if (packet.returnCode !== 0) throw new Error(`De kabel weigerde het lokale verzoek (code ${packet.returnCode}).`);
      const result = predicate(packet);
      if (result !== undefined) return result;
    }
    throw new Error('Geen passend antwoord van de kabel ontvangen.');
  }

  async send(command, payload, beforeWrite) {
    if (this.failure) throw this.failure;
    const frame = encodePacket({ version: this.version, key: this.key, sequence: ++this.sequence, command, payload });
    if (beforeWrite) beforeWrite();
    await new Promise((resolve, reject) => this.socket.write(frame, error => error ? reject(new Error('Versturen naar de kabel mislukt.')) : resolve()));
  }

  async negotiate() {
    const localNonce = randomBytes(16);
    await this.send(C.SESSION_START, localNonce);
    const remote = await this.receiveUntil(packet => packet.command === C.SESSION_RESPONSE ? packet.payload : undefined);
    if (remote.length !== 48) throw new Error('Ongeldig antwoord op lokale sessieonderhandeling.');
    const expected = createHmac('sha256', this.localKey).update(localNonce).digest();
    if (!timingSafeEqual(remote.subarray(16), expected)) throw new Error('De lokale sleutel is niet door de kabel bevestigd.');
    const remoteNonce = remote.subarray(0, 16);
    await this.send(C.SESSION_FINISH, createHmac('sha256', this.localKey).update(remoteNonce).digest());
    this.key = deriveSessionKey(this.localKey, localNonce, remoteNonce, this.version);
  }

  close() {
    this.intentionalClose = true;
    this.fail(new Error('Lokale sessie gesloten.'));
    this.socket?.destroy();
  }
}

function statusPayload(packet) {
  if (!packet.payload.length) return undefined;
  let value;
  try { value = JSON.parse(packet.payload.toString('utf8')); } catch {
    if (packet.payload.toString('utf8').includes('data unvalid')) {
      throw new Error('Dit apparaat vereist een specifieke DP-queryvariant; automatische DP-gissingen zijn uitgeschakeld.');
    }
    throw new Error('Onbekend formaat van het lokale kabelantwoord.');
  }
  if (value?.error || value?.Error) throw new Error('De kabel rapporteerde een fout bij het lokale verzoek.');
  const dps = value?.dps || value?.data?.dps;
  if (dps && typeof dps === 'object' && !Array.isArray(dps)) return { ...value, dps };
  return undefined;
}

class TuyaLanClient {
  constructor({ host, deviceId, localKey, version, timeoutMs = 5000, port = 6668 }) {
    if (!net.isIP(host)) throw new Error('Vul het lokale IP-adres van de kabel in.');
    if (typeof deviceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(deviceId)) throw new Error('Ongeldig lokaal Device ID.');
    if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error('Ongeldige lokale verbindingstime-out.');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Ongeldige lokale TCP-poort.');
    this.options = { host, deviceId, localKey: keyBytes(localKey), version: versionString(version), timeoutMs, port };
  }

  async withSession(operation) {
    const session = new Session(this.options);
    try { await session.open(); return await operation(session); }
    finally { session.close(); }
  }

  async getStatus() {
    return this.withSession(async session => {
      const modern = this.options.version !== '3.3';
      const payload = modern ? {} : { gwId: this.options.deviceId, devId: this.options.deviceId, uid: this.options.deviceId, t: String(Math.floor(Date.now() / 1000)) };
      await session.send(modern ? C.DP_QUERY_NEW : C.DP_QUERY, payload);
      return session.receiveUntil(packet => [C.DP_QUERY, C.DP_QUERY_NEW, C.STATUS, C.CONTROL_NEW].includes(packet.command) ? statusPayload(packet) : undefined);
    });
  }

  async refreshDps(dpIds) {
    if (!Array.isArray(dpIds) || !dpIds.length || dpIds.length > 255
      || dpIds.some(id => !Number.isInteger(id) || id < 1 || id > 255)) {
      throw new Error('Geef een lijst met numerieke DP-ID\u2019s van 1 tot en met 255 op.');
    }
    const requested = [...new Set(dpIds)];
    return this.withSession(async session => {
      let acknowledged = false;
      let status;
      const complete = () => status && requested.every(id => Object.hasOwn(status.dps, id));
      const receive = packet => {
        if (![C.DP_REFRESH, C.STATUS, C.DP_QUERY, C.DP_QUERY_NEW].includes(packet.command)) return undefined;
        const incoming = statusPayload(packet);
        if (incoming && requested.some(id => Object.hasOwn(incoming.dps, id))) {
          status = { ...status, ...incoming, dps: { ...status?.dps, ...incoming.dps } };
          return true;
        }
        if (packet.command === C.DP_REFRESH) { acknowledged = true; return true; }
        return undefined;
      };
      // UPDATEDPS is a read request, not CONTROL with null DP values. Firmware may
      // ACK first and asynchronously report only changed DPs via STATUS.
      await session.send(C.DP_REFRESH, { dpId: requested });
      await session.receiveUntil(receive);
      if (complete()) return status;
      try {
        await session.receiveUntil(packet => {
          receive(packet);
          return complete() ? status : undefined;
        }, Math.min(1000, this.options.timeoutMs));
      } catch (error) {
        if (!['TUYA_LAN_TIMEOUT', 'TUYA_LAN_CLOSED'].includes(error.code)) throw error;
        if (!status && !acknowledged) throw error;
      }
      // Never invent absent readings: an ACK confirms the refresh request only.
      return status || { acknowledged: true };
    });
  }

  async setDps(dps) {
    if (!dps || typeof dps !== 'object' || Array.isArray(dps) || !Object.keys(dps).length || Object.keys(dps).length > 256) throw new Error('Geef één of meer geldige DP-waarden op.');
    for (const [id, value] of Object.entries(dps)) {
      if (!/^[1-9][0-9]{0,4}$/.test(id) || Number(id) > 65535
        || !['boolean', 'string', 'number'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value))) {
        throw new Error('Ongeldige DP-ID of DP-waarde.');
      }
    }
    let sent = false;
    try {
      return await this.withSession(async session => {
        const modern = this.options.version !== '3.3';
        const timestamp = Math.floor(Date.now() / 1000);
        const payload = modern ? { protocol: 5, t: timestamp, data: { dps } }
          : { devId: this.options.deviceId, uid: this.options.deviceId, t: String(timestamp), dps };
        const command = modern ? C.CONTROL_NEW : C.CONTROL;
        await session.send(command, payload, () => { sent = true; });
        return session.receiveUntil(packet => {
          if (packet.command === command) {
            // A non-empty reply can carry a JSON/protocol error instead of an ack.
            statusPayload(packet);
            return { acknowledged: true };
          }
          if (packet.command === C.STATUS) {
            const state = statusPayload(packet);
            if (state && Object.entries(dps).every(([id, value]) => state.dps[id] === value)) return { acknowledged: true, status: state };
          }
          return undefined;
        });
      });
    } catch (error) {
      if (!sent) throw error;
      const uncertain = new Error('Laadopdracht verstuurd, maar lokaal niet bevestigd. De opdracht is niet opnieuw verstuurd.');
      uncertain.code = 'TUYA_LAN_UNCONFIRMED';
      uncertain.commandSent = true;
      throw uncertain;
    }
  }
}

module.exports = { TuyaLanClient };
