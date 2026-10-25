'use strict';

const { createHash, createHmac } = require('node:crypto');

const ENDPOINTS = Object.freeze([
  'https://openapi.tuyaeu.com', 'https://openapi-weaz.tuyaeu.com',
  'https://openapi.tuyaus.com', 'https://openapi-ueaz.tuyaus.com',
  'https://openapi.tuyacn.com', 'https://openapi.tuyain.com',
]);

class TuyaCloud {
  constructor({ endpoint, clientId, clientSecret, fetch = globalThis.fetch, now = Date.now }) {
    this.endpoint = String(endpoint || '').replace(/\/$/, '');
    if (!ENDPOINTS.includes(this.endpoint)) throw new Error('Selecteer een geldig Tuya-datacentrum.');
    if (typeof clientId !== 'string' || !clientId.trim() || typeof clientSecret !== 'string' || !clientSecret) {
      throw new Error('Tuya Client ID en Client Secret ontbreken.');
    }
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetch = fetch;
    this.now = now;
    this.token = null;
    this.tokenPromise = null;
  }

  async getToken() {
    if (this.token && this.token.expiresAt > this.now() + 60000) return this.token.value;
    if (!this.tokenPromise) {
      this.tokenPromise = (async () => {
        const token = await this.request('GET', '/v1.0/token?grant_type=1', undefined, '');
        if (!token?.access_token || !(Number(token.expire_time) > 0)) {
          throw new Error('Tuya stuurde geen geldig toegangstoken.');
        }
        this.token = { value: token.access_token, expiresAt: this.now() + Number(token.expire_time) * 1000 };
        return this.token.value;
      })().finally(() => { this.tokenPromise = null; });
    }
    return this.tokenPromise;
  }

  async request(method, path, payload, accessToken) {
    const token = accessToken === undefined ? await this.getToken() : accessToken;
    const url = new URL(path, this.endpoint);
    if (url.origin !== this.endpoint) throw new Error('Ongeldig API-pad.');
    url.searchParams.sort();
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const timestamp = String(this.now());
    const contentHash = createHash('sha256').update(body).digest('hex');
    const stringToSign = `${method}\n${contentHash}\n\n${url.pathname}${url.search}`;
    const sign = createHmac('sha256', this.clientSecret)
      .update(this.clientId + token + timestamp + stringToSign).digest('hex').toUpperCase();
    const headers = { client_id: this.clientId, t: timestamp, sign_method: 'HMAC-SHA256', sign };
    if (token) headers.access_token = token;
    if (body) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await this.fetch(url.toString(), {
        method, headers, ...(body ? { body } : {}),
        signal: AbortSignal.timeout(10000), redirect: 'error',
      });
    } catch {
      throw new Error('Tuya niet bereikbaar of verzoek verlopen; opdracht niet automatisch herhaald.');
    }
    if (!response.ok) throw new Error(`Tuya HTTP ${response.status}; controleer toegang en datacentrum.`);
    let data;
    try { data = await response.json(); } catch {
      throw new Error('Tuya stuurde een ongeldig antwoord; opdracht niet automatisch herhaald.');
    }
    if (!data || typeof data !== 'object') throw new Error('Tuya stuurde een ongeldig antwoord.');
    if (data.success !== true) {
      if (['1010', '1011'].includes(String(data.code))) this.token = null;
      // Do not expose response messages: third-party messages can include credentials.
      const code = /^[a-zA-Z0-9_-]{1,30}$/.test(String(data.code)) ? String(data.code) : 'unknown';
      throw new Error(`Tuya API ${code}; controleer projectrechten, accountkoppeling en datacentrum.`);
    }
    return data.result;
  }

  devicePath(deviceId) {
    if (typeof deviceId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(deviceId)) {
      throw new Error('Ongeldig Tuya Device ID.');
    }
    return `/v1.0/iot-03/devices/${deviceId}`;
  }

  async inspectDevice(deviceId) {
    const base = this.devicePath(deviceId);
    const [info, functions, status] = await Promise.all([
      this.request('GET', `/v1.0/devices/${deviceId}`),
      this.request('GET', `${base}/functions`),
      this.request('GET', `${base}/status`),
    ]);
    if (!Array.isArray(functions?.functions) || !Array.isArray(status)) {
      throw new Error('Onverwacht Tuya-schema of statusformaat.');
    }
    return { info, functions: functions.functions, status };
  }

  async readDevice(deviceId) {
    const base = this.devicePath(deviceId);
    const [info, status] = await Promise.all([
      this.request('GET', `/v1.0/devices/${deviceId}`),
      this.request('GET', `${base}/status`),
    ]);
    if (!Array.isArray(status)) throw new Error('Onverwacht Tuya-statusformaat.');
    return { info, status };
  }

  async command(deviceId, code, value) {
    const accepted = await this.request('POST', `${this.devicePath(deviceId)}/commands`, {
      commands: [{ code, value }],
    });
    if (accepted !== true) throw new Error('Tuya heeft de laadopdracht niet geaccepteerd.');
  }
}

module.exports = { TuyaCloud, ENDPOINTS };
