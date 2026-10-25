'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Onboarding } = require('../lib/onboarding');
const schema = require('./fixtures/voldt-schema.json').schema;

test('Voldt login discovers, verifies and prepares a cable without exposing its key or sending a charge command', async () => {
  const calls = [];
  const onboarding = new Onboarding({
    createAccount: () => ({
      async login(input) { calls.push(['login', input.email]); },
      async inspectDevice(id) { return { device: { devId: id, name: 'My Voldt', productId: 'product' }, products: [{ id: 'product', schemaInfo: { schema } }] }; },
      async getDeviceKey() { return '0123456789abcdef'; },
    }),
    discover: async () => ({ devices: [{ host: '192.168.1.50', deviceId: 'cable-id', version: '3.5' }] }),
    createLan: connection => ({
      async getStatus() { calls.push(['read', connection.deviceId]); return { dps: { '18': false, '9': 0, '1': 0 } }; },
      async setDps() { throw Error('Pairing must not switch charging'); },
    }),
  });
  try {
    const { token } = await onboarding.login({ email: 'owner@example.test', password: 'private-password', countryCode: '31', region: 'eu' });
    const found = await onboarding.find(token);
    assert.equal(found.devices.length, 1);
    assert.equal(found.devices[0].name, 'My Voldt');
    assert.equal(JSON.stringify(found).includes('0123456789abcdef'), false);
    assert.equal(JSON.stringify(found).includes('private-password'), false);
    const prepared = onboarding.getPrepared(token, 'cable-id');
    assert.equal(prepared.connection.localKey, '0123456789abcdef');
    assert.deepEqual(prepared.mapping, { dpId: '18', startValue: true, stopValue: false });
    assert.equal(prepared.telemetryProfile.measure_power.dpId, '9');
    assert.deepEqual(calls, [['login', 'owner@example.test'], ['read', 'cable-id']]);
    onboarding.logout(token);
    assert.throws(() => onboarding.getPrepared(token, 'cable-id'), { code: 'SESSION_EXPIRED' });
  } finally { onboarding.close(); }
});

test('account errors are sanitized and expired sessions cannot retrieve stored keys', async () => {
  let time = 0;
  const timers = new Set();
  const make = extra => new Onboarding({ createAccount: () => ({ login: async () => {} }), discover: async () => ({ devices: [] }), createLan: () => {},
    now: () => time, ttlMs: 1000, setTimer: fn => { timers.add(fn); return fn; }, clearTimer: fn => timers.delete(fn), ...extra });
  const bad = make({ createAccount: () => ({ login: async () => { throw Error('secret-password-and-session'); } }) });
  await assert.rejects(bad.login({ email: 'owner@example.test', password: 'secret' }), { message: 'ONBOARDING_FAILED' });
  bad.close();
  const good = make({});
  const { token } = await good.login({ email: 'owner@example.test', password: 'secret' });
  time = 1001;
  assert.throws(() => good.getPrepared(token, 'id'), { code: 'SESSION_EXPIRED' });
  assert.equal(timers.size, 0);
  good.close();
});

test('pairing tickets survive view disconnect, are device-bound and are consumed once', async () => {
  const onboarding = new Onboarding({ createAccount: () => ({ login: async () => {},
    inspectDevice: async id => ({ device: { productId: 'p', localKey: '0123456789abcdef' }, products: [{ id: 'p', schemaInfo: { schema } }] }) }),
    discover: async () => ({ devices: [{ host: '192.168.1.50', deviceId: 'cable-id', version: '3.5' }] }),
    createLan: () => ({ getStatus: async () => ({ dps: { '18': false } }) }) });
  try {
    const { token } = await onboarding.login({ email: 'owner@example.test', password: 'secret' });
    await assert.rejects(onboarding.find(token, { host: '8.8.8.8' }), { code: 'INPUT' });
    await onboarding.find(token);
    const ticket = onboarding.createTicket(token, 'cable-id');
    onboarding.logout(token);
    assert.throws(() => onboarding.takeTicket(ticket, 'other-id'), { code: 'SESSION_EXPIRED' });
    assert.equal(onboarding.takeTicket(ticket, 'cable-id').connection.localKey, '0123456789abcdef');
    assert.throws(() => onboarding.takeTicket(ticket, 'cable-id'), { code: 'SESSION_EXPIRED' });
  } finally { onboarding.close(); }
});

test('an account service failure during discovery is reported safely instead of claiming no cable exists', async () => {
  const onboarding = new Onboarding({ createAccount: () => ({ login: async () => {},
    inspectDevice: async () => { throw Object.assign(new Error('private server data'), { code: 'OEM_NETWORK_ERROR' }); } }),
    discover: async () => ({ devices: [{ host: '192.168.1.50', deviceId: 'cable-id', version: '3.5' }] }),
    createLan: () => { throw Error('Unexpected LAN call'); } });
  try {
    const { token } = await onboarding.login({ email: 'owner@example.test', password: 'secret' });
    await assert.rejects(onboarding.find(token), { code: 'OEM_NETWORK_ERROR', message: 'OEM_NETWORK_ERROR' });
  } finally { onboarding.close(); }
});
