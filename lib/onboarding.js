'use strict';
const { randomBytes } = require('node:crypto');
const net = require('node:net');
const { validateLocalMapping } = require('./local-charger');
const { createTelemetryProfile } = require('./charger-telemetry');

const PUBLIC_ERRORS = new Set(['OEM_CONFIG', 'USER_PASSWD_WRONG', 'USER_NOT_EXISTS', 'USER_SESSION_INVALID', 'OEM_NETWORK_ERROR',
  'OEM_DEVICE_KEY_MISSING', 'OEM_PRODUCT_SCHEMA_MISSING', 'OEM_PRODUCT_MISSING', 'OEM_ACCOUNT_DOMAIN',
  'OEM_SIGNATURE_FAILED', 'OEM_DECRYPT_FAILED', 'OEM_HTTP_429', 'ILLEGAL_CLIENT_ID', 'CAPTCHA_REQUIRED',
  'SESSION_EXPIRED', 'BUSY', 'INPUT', 'NO_CABLE', 'UNSUPPORTED_CABLE', 'NO_LOCAL_CONNECTION', 'ONBOARDING_FAILED']);
function failure(code) { return Object.assign(new Error(code), { code }); }
function publicError(error) { return failure(PUBLIC_ERRORS.has(error?.code) ? error.code : 'ONBOARDING_FAILED'); }
function localHost(host) {
  if (net.isIP(host) !== 4) return false;
  const [a, b] = host.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}
function schemaFrom(metadata) {
  const product = metadata?.products?.find(item => item.id === metadata.device?.productId);
  let info = product?.schemaInfo;
  if (typeof info === 'string') info = JSON.parse(info);
  const schema = typeof info?.schema === 'string' ? JSON.parse(info.schema) : info?.schema;
  if (!Array.isArray(schema)) throw failure('UNSUPPORTED_CABLE');
  const switches = schema.filter(item => item.code === 'switch' && item.mode === 'rw');
  const property = item => typeof item?.property === 'string' ? JSON.parse(item.property) : item?.property;
  const states = schema.find(item => item.code === 'work_state');
  if (switches.length !== 1 || property(switches[0])?.type !== 'bool'
    || !property(states)?.range?.includes('charger_charging')) throw failure('UNSUPPORTED_CABLE');
  return { schema, dpId: String(switches[0].id) };
}

class Onboarding {
  #sessions = new Map();
  #tickets = new Map();
  #createAccount;
  #discover;
  #createLan;
  #ttl;
  #now;
  #setTimer;
  #clearTimer;
  #logins = 0;
  #closed = false;

  constructor({ createAccount, discover, createLan, ttlMs = 600000, now = Date.now,
    setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.#createAccount = createAccount;
    this.#discover = discover;
    this.#createLan = createLan;
    this.#ttl = ttlMs;
    this.#now = now;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
  }

  async login(input) {
    if (this.#closed) throw failure('SESSION_EXPIRED');
    if (!input || typeof input.email !== 'string' || input.email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(input.email.trim())
      || typeof input.password !== 'string' || !input.password || input.password.length > 1024
      || !/^\d{1,4}$/.test(String(input.countryCode || '31')) || !['eu', 'us', 'in', 'ru'].includes(input.region || 'eu')) throw failure('INPUT');
    if (this.#logins >= 2 || this.#sessions.size >= 8) throw failure('BUSY');
    this.#logins++;
    try {
      const account = this.#createAccount(input.region || 'eu');
      await account.login({ email: input.email.trim(), password: input.password, countryCode: String(input.countryCode || '31') });
      if (this.#closed) throw failure('SESSION_EXPIRED');
      const token = randomBytes(24).toString('hex');
      const expiresAt = this.#now() + this.#ttl;
      const timer = this.#setTimer(() => this.logout(token), this.#ttl);
      timer?.unref?.();
      this.#sessions.set(token, { account, expiresAt, timer, prepared: new Map(), busy: false });
      return { token, expiresAt };
    } catch (error) { throw publicError(error); }
    finally { this.#logins--; }
  }

  #session(token) {
    const session = typeof token === 'string' ? this.#sessions.get(token) : undefined;
    if (!session || session.expiresAt <= this.#now()) { this.logout(token); throw failure('SESSION_EXPIRED'); }
    return session;
  }

  async find(token, { host, deviceId } = {}) {
    const session = this.#session(token);
    if (host && !localHost(host)) throw failure('INPUT');
    if (session.busy) throw failure('BUSY');
    session.busy = true;
    try {
      const result = await this.#discover({ host: host || undefined, durationMs: 4000 });
      const candidates = result.devices.filter(item => localHost(item.host) && /^[a-z0-9_-]{1,128}$/i.test(item.deviceId)
        && ['3.3', '3.4', '3.5'].includes(item.version) && (!deviceId || item.deviceId === deviceId)).slice(0, 16);
      const found = [];
      const deadline = this.#now() + 25000;
      session.prepared.clear();
      for (const target of candidates) {
        try {
          const metadata = await session.account.inspectDevice(target.deviceId);
          const { schema, dpId } = schemaFrom(metadata);
          const localKey = typeof metadata.device.localKey === 'string' && Buffer.byteLength(metadata.device.localKey) === 16
            ? metadata.device.localKey : await session.account.getDeviceKey(target.deviceId);
          const connection = { host: target.host, deviceId: target.deviceId, version: target.version, localKey };
          const status = await this.#createLan(connection).getStatus();
          const mapping = validateLocalMapping({ dpId, startValue: true, stopValue: false }, status.dps);
          const prepared = { connection, mapping, telemetryProfile: createTelemetryProfile(schema),
            name: typeof metadata.device.name === 'string' ? metadata.device.name.slice(0, 80) : 'Voldt' };
          this.#session(token);
          session.prepared.set(target.deviceId, prepared);
          found.push({ id: target.deviceId, name: prepared.name, host: target.host, version: target.version });
        } catch (error) {
          if (['SESSION_EXPIRED', 'USER_SESSION_INVALID', 'OEM_NETWORK_ERROR', 'OEM_HTTP_429',
            'ILLEGAL_CLIENT_ID', 'OEM_ACCOUNT_DOMAIN', 'OEM_SIGNATURE_FAILED', 'OEM_DECRYPT_FAILED'].includes(error.code)) throw error;
          // Foreign accounts, unsupported schemas and failed LAN checks are never offered for pairing.
        }
        if (this.#now() >= deadline) break;
      }
      return { devices: found };
    } catch (error) { throw publicError(error); }
    finally { session.busy = false; }
  }

  getPrepared(token, deviceId) {
    const prepared = this.#session(token).prepared.get(deviceId);
    if (!prepared) throw failure('NO_CABLE');
    return prepared;
  }

  createTicket(token, deviceId) {
    if (this.#tickets.size >= 64) throw failure('BUSY');
    const prepared = this.getPrepared(token, deviceId);
    const ticket = randomBytes(24).toString('hex');
    const timer = this.#setTimer(() => this.#tickets.delete(ticket), this.#ttl);
    timer?.unref?.();
    this.#tickets.set(ticket, { prepared, deviceId, expiresAt: this.#now() + this.#ttl, timer });
    return ticket;
  }

  takeTicket(ticket, deviceId) {
    const entry = this.#tickets.get(ticket);
    if (!entry || entry.deviceId !== deviceId || entry.expiresAt <= this.#now()) throw failure('SESSION_EXPIRED');
    this.#tickets.delete(ticket);
    this.#clearTimer(entry.timer);
    return entry.prepared;
  }

  logout(token) {
    const session = this.#sessions.get(token);
    if (session) { this.#clearTimer(session.timer); session.prepared.clear(); this.#sessions.delete(token); }
  }

  close() {
    this.#closed = true;
    for (const token of this.#sessions.keys()) this.logout(token);
    for (const entry of this.#tickets.values()) this.#clearTimer(entry.timer);
    this.#tickets.clear();
  }
}

module.exports = { Onboarding, publicError, localHost };
