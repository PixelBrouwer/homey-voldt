'use strict';
const { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual, createPublicKey, publicEncrypt, constants } = require('node:crypto');
const { gunzipSync } = require('node:zlib');

const SIGNED_FIELDS = new Set(['a', 'v', 'lat', 'lon', 'lang', 'deviceId', 'appVersion', 'ttid', 'isH5',
  'h5Token', 'os', 'clientId', 'postData', 'time', 'requestId', 'et', 'n4h5', 'sid', 'chKey', 'sp']);

class OemMobileCrypto {
  #signingKey;
  #channelInput;

  constructor({ packageName, certificateSha256, containerSecret, appSecret }) {
    const digest = String(certificateSha256 || '').replaceAll(':', '');
    if (!packageName || !/^[a-f0-9]{64}$/i.test(digest) || !containerSecret || !appSecret) {
      throw new Error('De gereconstrueerde OEM-appidentiteit is onvolledig.');
    }
    const certificate = digest.toUpperCase().match(/../g).join(':');
    this.#channelInput = `${packageName}_${certificate}`;
    this.#signingKey = `${packageName}_${certificate}_${containerSecret}_${appSecret}`;
  }

  channelKey(clientId) {
    return createHmac('sha256', clientId).update(this.#channelInput).digest('hex').slice(8, 16);
  }

  #key(requestId, suffix = '') {
    if (typeof requestId !== 'string' || !requestId) throw new Error('Request-ID ontbreekt.');
    const data = this.#signingKey + (suffix ? `_${suffix}` : '');
    // JNI returns the first 16 ASCII characters of a lowercase hex digest.
    return Buffer.from(createHmac('sha256', requestId).update(data).digest('hex').slice(0, 16));
  }

  seal(postData, { requestId, ecode = '', iv = randomBytes(12) }) {
    if (!Buffer.isBuffer(iv) || iv.length !== 12) throw new Error('Ongeldige GCM-nonce.');
    const plaintext = Buffer.from(typeof postData === 'string' ? postData : JSON.stringify(postData));
    const cipher = createCipheriv('aes-128-gcm', this.#key(requestId, ecode), iv);
    return Buffer.concat([iv, cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]).toString('base64');
  }

  openResponse(encoded, { requestId, sid = '', ecode = '', gzip = false, route = 'business' }) {
    try {
      if (typeof encoded !== 'string' || encoded.length > 6 * 1024 * 1024
        || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('Invalid frame');
      let suffix = route === 'fusion' ? '' : ecode;
      if (route === 'fusion' && sid) {
        if (typeof sid !== 'string' || sid.length < 16) throw new Error('Invalid session ID');
        for (let i = 0; i < 16; i++) suffix += sid[sid.charCodeAt(i) & 15];
      }
      const frame = Buffer.from(encoded, 'base64');
      if (frame.length < 28) throw new Error('Truncated frame');
      const decipher = createDecipheriv('aes-128-gcm', this.#key(requestId, suffix), frame.subarray(0, 12));
      decipher.setAuthTag(frame.subarray(-16));
      let plaintext = Buffer.concat([decipher.update(frame.subarray(12, -16)), decipher.final()]);
      if (gzip) plaintext = gunzipSync(plaintext, { maxOutputLength: 4 * 1024 * 1024 });
      return JSON.parse(plaintext.toString('utf8'));
    } catch {
      throw Object.assign(new Error('Voldt-response kon niet veilig worden ontsleuteld.'), { code: 'OEM_DECRYPT_FAILED' });
    }
  }

  unwrapResponse(outer, options) {
    if (!outer || typeof outer !== 'object' || Array.isArray(outer)) throw new Error('Ongeldige Voldt-response.');
    if (outer.sign === undefined || outer.sign === null || outer.sign === '') return outer;
    const digestKey = options.route === 'fusion' ? this.#signingKey : this.#key(options.requestId, options.ecode).toString('utf8');
    const expected = createHash('md5').update(`result=${outer.result}||t=${outer.t}||${digestKey}`).digest('hex');
    if (typeof outer.sign !== 'string' || !/^[a-f0-9]{32}$/i.test(outer.sign)
      || !timingSafeEqual(Buffer.from(expected), Buffer.from(outer.sign.toLowerCase()))) {
      throw Object.assign(new Error('De Voldt-response heeft een ongeldige handtekening.'), { code: 'OEM_SIGNATURE_FAILED' });
    }
    return this.openResponse(outer.result, options);
  }

  sign(fields) {
    const parts = [];
    for (const name of Object.keys(fields).sort()) {
      const value = fields[name];
      if (!SIGNED_FIELDS.has(name) || value === null || value === undefined || String(value) === '') continue;
      let encoded = String(value);
      if (name === 'postData') {
        const md5 = createHash('md5').update(encoded).digest('hex');
        encoded = md5.slice(8, 16) + md5.slice(0, 8) + md5.slice(24, 32) + md5.slice(16, 24);
      }
      parts.push(`${name}=${encoded}`);
    }
    return createHmac('sha256', this.#signingKey).update(parts.join('||')).digest('hex');
  }
}

function encryptEmailPassword(password, token) {
  if (typeof password !== 'string' || !password || !/^\d{100,2500}$/.test(String(token?.publicKey))
    || !/^\d{1,12}$/.test(String(token?.exponent))) throw new Error('Voldt gaf geen geldige RSA-inloggegevens terug.');
  function unsigned(value) {
    let hex = BigInt(value).toString(16);
    if (hex.length % 2) hex = `0${hex}`;
    return Buffer.from(hex, 'hex').toString('base64url');
  }
  const key = createPublicKey({ format: 'jwk', key: { kty: 'RSA', n: unsigned(token.publicKey), e: unsigned(token.exponent) } });
  const md5 = createHash('md5').update(password, 'utf8').digest('hex');
  return publicEncrypt({ key, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(md5, 'ascii')).toString('hex');
}

module.exports = { OemMobileCrypto, encryptEmailPassword };
