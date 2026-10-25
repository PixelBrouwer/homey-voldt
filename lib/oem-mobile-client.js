'use strict';
const { randomUUID } = require('node:crypto');
const { encryptEmailPassword } = require('./oem-mobile-crypto');

// Decoded from this APK's thing_domains_v1/regions asset.
const REGIONS = { eu: 'https://a1.tuyaeu.com/api.json', us: 'https://a1-us.iotbing.com/api.json',
  in: 'https://a1-in.iotbing.com/api.json', ru: 'https://a1.iot334.com/api.json' };
const API_DOMAINS = ['tuyaeu.com', 'tuyaus.com', 'tuyacn.com', 'tuyain.com', 'iotbing.com', 'iot334.com'];

function apiError(code, action) {
  const safe = typeof code === 'string' && /^[a-z0-9_.-]{1,80}$/i.test(code) ? code : 'OEM_API_ERROR';
  return Object.assign(new Error(`Voldt-aanvraag mislukt (${safe}).`), { code: safe, action });
}

function accountEndpoint(domain, fallback) {
  let data = domain;
  if (typeof data === 'string' && data.trim().startsWith('{')) {
    try { data = JSON.parse(data); } catch { throw apiError('OEM_ACCOUNT_DOMAIN'); }
  }
  const address = typeof data === 'string' && data.startsWith('https://') ? data : data?.mobileApiUrl;
  if (!address) return fallback;
  let url;
  try { url = new URL(address); } catch { throw apiError('OEM_ACCOUNT_DOMAIN'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || (url.port && url.port !== '443') || !['/', '/api.json'].includes(url.pathname)
    || !API_DOMAINS.some(name => url.hostname === name || url.hostname.endsWith(`.${name}`))) {
    throw apiError('OEM_ACCOUNT_DOMAIN');
  }
  url.pathname = '/api.json';
  return url.toString();
}

class OemMobileClient {
  #clientId;
  #crypto;
  #fetch;
  #endpoint;
  #session;
  #onAuthenticated;
  #timeout;

  constructor({ clientId, crypto, region = 'eu', fetchImpl = fetch, onAuthenticated, session, timeoutMs = 20000 }) {
    if (typeof clientId !== 'string' || !clientId || !crypto || !REGIONS[region]) throw apiError('OEM_CONFIG');
    this.#clientId = clientId;
    this.#crypto = crypto;
    this.#fetch = fetchImpl;
    this.#endpoint = REGIONS[region];
    this.#onAuthenticated = onAuthenticated;
    this.#timeout = Math.min(20000, Math.max(1000, timeoutMs));
    if (session) {
      if (session.clientId !== clientId || typeof session.sid !== 'string' || session.sid.length < 16) throw apiError('OEM_INVALID_SESSION');
      this.#endpoint = accountEndpoint(session.endpoint, this.#endpoint);
      this.#session = { sid: session.sid, ecode: typeof session.ecode === 'string' ? session.ecode : '' };
    }
  }

  async #call(action, version, postData, requiresSession = false) {
    const session = requiresSession ? this.#session : null;
    if (requiresSession && !session) throw apiError('OEM_NOT_LOGGED_IN', action);
    const requestId = randomUUID();
    const wireAction = action.startsWith('thing') ? `smartlife${action.slice(5)}` : action;
    const fields = { a: wireAction, v: version, clientId: this.#clientId, os: 'Android', appVersion: '1.0.2',
      lang: 'nl_NL', sdkVersion: '7.9.0', deviceCoreVersion: '7.9.0',
      ttid: `sdk_international@${this.#clientId}`, osSystem: '14', requestId, platform: 'Linux',
      timeZoneId: 'Europe/Amsterdam', et: '3', cp: 'gzip', channel: 'oem', nd: '1',
      appRnVersion: '7.8',
      chKey: this.#crypto.channelKey(this.#clientId),
      bizData: JSON.stringify({ customDomainSupport: '1', nd: '1', sdkInt: '34', brand: 'generic' }),
      time: String(Math.floor(Date.now() / 1000)),
      ...(session ? { sid: session.sid } : {}),
      postData: this.#crypto.seal(postData, { requestId, ecode: session?.ecode || '' }),
    };
    fields.sign = this.#crypto.sign(fields);
    let response;
    try {
      response = await this.#fetch(this.#endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(this.#timeout),
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-client-trace-id': requestId,
          'user-agent': 'Thing-UA=APP/Android/1.0.2/SDK/7.9.0' }, body: new URLSearchParams(fields).toString() });
    } catch { throw apiError('OEM_NETWORK_ERROR', action); }
    if (!response.ok) throw apiError(`OEM_HTTP_${response.status}`, action);
    let outer;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 6 * 1024 * 1024) throw new Error('Response limit');
        chunks.push(Buffer.from(chunk));
      }
      outer = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { throw apiError('OEM_INVALID_RESPONSE', action); }
    const business = this.#crypto.unwrapResponse(outer, { requestId, ecode: session?.ecode || '',
      gzip: response.headers.get('x-content-compress')?.toLowerCase() === 'gzip' });
    if (business?.success !== true) throw apiError(business?.errorCode, action);
    return business.result;
  }

  async login({ email, password, countryCode = '31' }) {
    this.#session = null;
    if (typeof email !== 'string' || !email || typeof password !== 'string' || !password
      || !/^\d{1,4}$/.test(String(countryCode))) throw apiError('OEM_INPUT');
    const token = await this.#call('thing.m.user.username.token.get', '2.0',
      { countryCode: String(countryCode), username: email, isUid: false });
    if (typeof token?.token !== 'string' || !token.token) throw apiError('OEM_INVALID_LOGIN_TOKEN');
    const encrypted = encryptEmailPassword(password, token);
    const user = await this.#call('thing.m.user.email.password.login', '3.0',
      { countryCode: String(countryCode), email, passwd: encrypted, options: '{"group": 1}', token: token.token, ifencrypt: 1 });
    if (typeof user?.sid !== 'string' || user.sid.length < 16) throw apiError('OEM_INVALID_LOGIN_RESULT');
    const endpoint = accountEndpoint(user.domain, this.#endpoint);
    this.#session = { sid: user.sid, ecode: typeof user.ecode === 'string' ? user.ecode : '' };
    this.#endpoint = endpoint;
    if (this.#onAuthenticated) await this.#onAuthenticated({ ...this.#session, endpoint, clientId: this.#clientId });
    return { authenticated: true };
  }

  async getDeviceKey(deviceId) {
    if (typeof deviceId !== 'string' || !/^[a-z0-9_-]{1,128}$/i.test(deviceId)) throw apiError('OEM_INVALID_DEVICE');
    const result = await this.#call('thing.m.device.key.get', '1.0', { gwId: deviceId }, true);
    const device = Array.isArray(result) ? result.find(item => item?.devId === deviceId || item?.gwId === deviceId) : undefined;
    if (typeof device?.localKey !== 'string' || Buffer.byteLength(device.localKey) !== 16) throw apiError('OEM_DEVICE_KEY_MISSING');
    return device.localKey;
  }

  async inspectDevice(deviceId) {
    if (typeof deviceId !== 'string' || !/^[a-z0-9_-]{1,128}$/i.test(deviceId)) throw apiError('OEM_INVALID_DEVICE');
    const device = await this.#call('thing.m.device.get', '4.1', { devId: deviceId }, true);
    if (typeof device?.productId !== 'string' || !device.productId) throw apiError('OEM_PRODUCT_MISSING');
    const product = { pid: device.productId };
    if (device.productVer !== undefined && device.productVer !== null) product.ver = device.productVer;
    const products = await this.#call('thing.m.device.ref.info.list', '6.1',
      { productIds: JSON.stringify([product]), zigbeeGroup: true }, true);
    if (!Array.isArray(products)) throw apiError('OEM_PRODUCT_SCHEMA_MISSING');
    return { device, products };
  }
}

module.exports = { OemMobileClient };
