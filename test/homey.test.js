'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Only the Homey SDK and network boundary are substituted; cloud, mapping and
// charging code execute together through the actual device lifecycle.
function deviceClass() {
  class Device {
    constructor() {
      this.values = {};
      this.capabilities = new Set(['evcharger_charging']);
      this.listeners = {};
      this.available = false;
      this.store = {
        auth: { endpoint: 'https://openapi.tuyaeu.com', clientId: 'test-client', clientSecret: 'test-secret' },
        mapping: { code: 'example_control', startValue: true, stopValue: false },
      };
      this.homey = { __: key => key.split('.').reduce((value, part) => value[part], require('../locales/nl.json')),
        setTimeout: callback => { this.scheduled = callback; return 1; }, clearTimeout: () => { this.scheduled = null; } };
    }
    getStoreValue(key) {
      return this.store[key];
    }
    hasCapability(id) { return this.capabilities.has(id); }
    async addCapability(id) { this.capabilities.add(id); this.values[id] = null; }
    async setStoreValue(key, value) { this.store[key] = value; }
    async unsetStoreValue(key) { delete this.store[key]; }
    getData() { return { id: 'example-device' }; }
    getName() { return 'Example cable'; }
    getSetting() { return 60; }
    registerCapabilityListener(key, listener) { this.listeners[key] = listener; }
    async setCapabilityValue(key, value) { this.values[key] = value; }
    async setAvailable() { this.available = true; }
    async setUnavailable(message) { this.available = false; this.unavailableReason = message; }
  }
  const filename = path.resolve(__dirname, '../drivers/voldt/device.js');
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  const wrapper = vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
  wrapper(name => name === 'homey' ? { Device } : nativeRequire(name), module, module.exports);
  return module.exports;
}

function cloudService() {
  const service = { online: true, state: false, commands: [] };
  service.fetch = async (url, options) => {
    const route = new URL(url).pathname;
    let result;
    if (route === '/v1.0/token') result = { access_token: 'test-token', expire_time: 7200 };
    else if (route.endsWith('/functions')) result = { functions: [{ code: 'example_control', type: 'Boolean', values: '{}' }] };
    else if (route.endsWith('/status')) result = [{ code: 'example_control', value: service.state }];
    else if (route.endsWith('/commands')) {
      service.commands.push(JSON.parse(options.body));
      service.state = service.commands.at(-1).commands[0].value;
      result = true;
    } else result = { online: service.online, name: 'Example cable' };
    return { ok: true, json: async () => ({ success: true, result }) };
  };
  return service;
}

test('Homey startup only reads, charging events control the cable, deletion cancels polling', async t => {
  const service = cloudService();
  t.mock.method(globalThis, 'fetch', service.fetch);
  const Device = deviceClass();
  const device = new Device();
  await device.onInit();
  assert.deepEqual(service.commands, []);
  assert.equal(device.values.evcharger_charging, false);
  assert.equal(device.available, true);
  await device.listeners.evcharger_charging(true);
  await device.listeners.evcharger_charging(false);
  assert.deepEqual(service.commands.map(item => item.commands[0].value), [true, false]);
  await device.onDeleted();
  assert.equal(device.scheduled, null);
});

test('Homey marks an offline cable unavailable without pretending it is off or sending a command', async t => {
  const service = cloudService();
  service.online = false;
  t.mock.method(globalThis, 'fetch', service.fetch);
  const Device = deviceClass();
  const device = new Device();
  await device.onInit();
  assert.equal(device.available, false);
  assert.equal(device.values.evcharger_charging, undefined);
  await assert.rejects(device.listeners.evcharger_charging(true), /offline/);
  assert.equal(service.commands.length, 0);
  await device.onDeleted();
});

test('an unconfigured Homey cable stays unavailable without network calls or a fabricated state', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('Unexpected network call'); });
  const Device = deviceClass();
  const device = new Device();
  device.store = { pendingSetup: true };
  await device.onInit();
  assert.equal(device.available, false);
  assert.match(device.unavailableReason, /nog niet gekoppeld/);
  assert.equal(device.values.evcharger_charging, undefined);
  await assert.rejects(device.listeners.evcharger_charging(true), /Laadbediening nog niet ingesteld/);
  assert.equal(calls, 0);
});

test('repair links an existing cable in place and only reads its current status', async t => {
  const service = cloudService();
  t.mock.method(globalThis, 'fetch', service.fetch);
  const Device = deviceClass();
  const device = new Device();
  const auth = device.store.auth;
  const mapping = device.store.mapping;
  device.store = { pendingSetup: true };
  await device.onInit();
  await device.configure({ auth, deviceId: 'real-device-id', mapping });
  assert.equal(device.available, true);
  assert.equal(device.store.deviceId, 'real-device-id');
  assert.equal(device.store.pendingSetup, false);
  assert.equal(device.values.evcharger_charging, false);
  assert.equal(service.commands.length, 0);
  await device.onDeleted();
});

test('app configuration lists existing cables without returning stored credentials', async () => {
  const api = require('../api');
  const Device = deviceClass();
  const device = new Device();
  const homey = { drivers: { getDriver: () => ({ getDevices: () => [device] }) } };
  const result = await api.listDevices({ homey });
  assert.deepEqual(result, [{ key: 'example-device', name: 'Example cable', configured: true, local: null }]);
  assert.doesNotMatch(JSON.stringify(result), /test-secret|test-client/);
});

test('app configuration connects the existing device only after validating the selected function', async t => {
  const api = require('../api');
  const service = cloudService();
  t.mock.method(globalThis, 'fetch', service.fetch);
  const Device = deviceClass();
  const device = new Device();
  const auth = device.store.auth;
  device.store = { pendingSetup: true };
  await device.onInit();
  const homey = { drivers: { getDriver: () => ({ getDevices: () => [device] }) } };
  const body = { deviceKey: 'example-device', deviceId: 'real-device-id', auth, verified: true,
    mapping: { code: 'guessed_dp_1', startValue: true, stopValue: false } };
  await assert.rejects(api.configureDevice({ homey, body }), /ontbreekt/);
  assert.equal(device.available, false);
  body.mapping.code = 'example_control';
  const result = await api.configureDevice({ homey, body });
  assert.deepEqual(result, { configured: true });
  assert.equal(device.available, true);
  assert.equal(device.store.deviceId, 'real-device-id');
  assert.equal(service.commands.length, 0);
  await device.onDeleted();
});

test('local connection metadata never returns the saved device key', async () => {
  const api = require('../api');
  const Device = deviceClass();
  const device = new Device();
  device.store = {
    pendingSetup: false, connectionType: 'local',
    localConnection: { host: '192.168.1.50', deviceId: 'example-device', version: '3.5', localKey: 'private-local-key' },
    localMapping: { dpId: '101', startValue: true, stopValue: false },
  };
  const homey = { drivers: { getDriver: () => ({ getDevices: () => [device] }) } };
  const result = await api.listDevices({ homey });
  assert.equal(result[0].configured, true);
  assert.equal(result[0].local.hasKey, true);
  assert.equal(result[0].local.host, '192.168.1.50');
  assert.doesNotMatch(JSON.stringify(result), /private-local-key/);
});

test('missing local keys stop connection setup before opening any network socket', async t => {
  const api = require('../api');
  const net = require('node:net');
  let connections = 0;
  t.mock.method(net.Socket.prototype, 'connect', () => { connections++; throw new Error('Unexpected connection'); });
  const Device = deviceClass();
  const device = new Device();
  device.store = { pendingSetup: true };
  const homey = { drivers: { getDriver: () => ({ getDevices: () => [device] }) } };
  await assert.rejects(api.inspectLocal({ homey, body: { deviceKey: 'example-device', connection: {
    host: '192.168.1.50', deviceId: 'example-device', version: '3.5',
  } } }), /sleutel ontbreekt/);
  assert.equal(connections, 0);
});

test('a verified key can be saved while charging remains unavailable until its control is confirmed', async t => {
  const api = require('../api');
  const { TuyaLanClient } = require('../lib/tuya-lan-client');
  t.mock.method(TuyaLanClient.prototype, 'getStatus', async () => ({ dps: { '16': true } }));
  t.mock.method(TuyaLanClient.prototype, 'setDps', async () => { throw Error('No charging command expected'); });
  const Device = deviceClass();
  const device = new Device();
  device.store = { pendingSetup: true };
  const homey = { drivers: { getDriver: () => ({ getDevices: () => [device] }) } };
  const connection = { host: '192.168.1.50', deviceId: 'fixture-device', version: '3.5', localKey: '0123456789abcdef' };
  await device.onInit();
  const result = await api.inspectLocal({ homey, body: { deviceKey: 'example-device', connection, remember: true } });
  assert.equal(result.connected, true);
  assert.equal(device.store.localConnection.localKey, connection.localKey);
  assert.equal(device.store.pendingSetup, true);
  await device.onInit();
  assert.equal(device.available, false);
  assert.match(device.unavailableReason, /laadbediening.*bevestig/i);
  assert.doesNotMatch(device.unavailableReason, /sleutel ontbreekt/);
  const listed = await api.listDevices({ homey });
  assert.equal(listed[0].local.hasKey, true);
  assert.equal(listed[0].configured, false);
  assert.equal(JSON.stringify(listed).includes(connection.localKey), false);
});

test('local inspection requests share the device queue and do not open simultaneous cable sessions', async t => {
  const api = require('../api');
  const { TuyaLanClient } = require('../lib/tuya-lan-client');
  let active = 0;
  let peak = 0;
  t.mock.method(TuyaLanClient.prototype, 'getStatus', async () => {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return { dps: { '18': false } };
  });
  const Device = deviceClass();
  const device = new Device();
  device.store = { pendingSetup: true };
  await device.onInit();
  const homey = { drivers: { getDriver: () => ({ getDevices: () => [device] }) } };
  const body = { deviceKey: 'example-device', connection: {
    host: '192.168.1.50', deviceId: 'fixture-device', version: '3.5', localKey: '0123456789abcdef' } };
  await Promise.all([api.inspectLocal({ homey, body }), api.inspectLocal({ homey, body })]);
  assert.equal(peak, 1);
});

test('the existing local Homey device gains energy sensors and updates them from cable measurements', async t => {
  const { TuyaLanClient } = require('../lib/tuya-lan-client');
  const { createTelemetryProfile } = require('../lib/charger-telemetry');
  let dps = { '18': true, '1': 12345, '9': 2875, '24': 18, '4': 13, '25': 67, '3': 'charger_charging' };
  let reads = 0;
  t.mock.method(TuyaLanClient.prototype, 'getStatus', async () => { reads++; return { dps }; });
  t.mock.method(TuyaLanClient.prototype, 'setDps', async () => { throw Error('A meter read must not control charging'); });
  const Device = deviceClass();
  const device = new Device();
  device.store = { pendingSetup: false, connectionType: 'local',
    localConnection: { host: '192.168.1.50', deviceId: 'fixture-device', version: '3.5', localKey: '0123456789abcdef' },
    localMapping: { dpId: '18', startValue: true, stopValue: false },
    localTelemetry: createTelemetryProfile(require('./fixtures/voldt-schema.json').schema) };
  await device.onInit();
  assert.equal(device.available, true);
  assert.equal(device.hasCapability('measure_power'), true);
  assert.equal(device.values.measure_power, 2875);
  assert.equal(device.values.meter_power, 123.45);
  assert.equal(device.values.meter_energy_session, 0.67);
  assert.equal(device.values.measure_current_limit, 13);
  assert.equal(device.values.charge_state, 'charger_charging');
  assert.equal(reads, 1);
  dps = { '18': false, '1': 12345, '9': 0, '24': 19, '4': 13, '3': 'charger_end' };
  await device.poll();
  assert.equal(device.values.measure_power, 0);
  assert.equal(device.values.evcharger_charging, false);
  assert.equal(device.values.meter_energy_session, null);
  assert.equal(reads, 2);
  await device.onDeleted();
});

test('a newly paired device receives secrets inside Homey and never starts charging during setup', async t => {
  const { TuyaLanClient } = require('../lib/tuya-lan-client');
  t.mock.method(TuyaLanClient.prototype, 'getStatus', async () => ({ dps: { '18': false, '9': 0, '1': 0 } }));
  t.mock.method(TuyaLanClient.prototype, 'setDps', async () => { throw Error('Pairing must not start charging'); });
  const Device = deviceClass();
  const device = new Device();
  device.store = { setupTicket: 'opaque-ticket', pendingSetup: true };
  device.driver = { takeSetupTicket(ticket, id) {
    assert.equal(ticket, 'opaque-ticket'); assert.equal(id, 'example-device');
    return { connection: { host: '192.168.1.50', deviceId: 'example-device', version: '3.5', localKey: '0123456789abcdef' },
      mapping: { dpId: '18', startValue: true, stopValue: false }, telemetryProfile: {} };
  } };
  await device.onInit();
  assert.equal(device.available, true);
  assert.equal(device.store.pendingSetup, false);
  assert.equal(device.store.localConnection.localKey, '0123456789abcdef');
  assert.equal(device.store.setupTicket, undefined);
  assert.equal(device.values.evcharger_charging, false);
  await device.onDeleted();
});

test('a timed-out pairing can be repaired in app settings and controlled without restarting Homey', async t => {
  const { TuyaLanClient } = require('../lib/tuya-lan-client');
  let enabled = false;
  t.mock.method(TuyaLanClient.prototype, 'getStatus', async () => ({ dps: { '18': enabled } }));
  t.mock.method(TuyaLanClient.prototype, 'setDps', async dps => { enabled = dps['18']; });
  const Device = deviceClass();
  const device = new Device();
  device.store = { pendingSetup: true, setupTicket: 'expired' };
  device.driver = { takeSetupTicket() { throw Error('expired'); } };
  await device.onInit();
  assert.equal(device.available, false);
  await device.configureLocal({ connection: { host: '192.168.1.50', deviceId: 'example-device', version: '3.5', localKey: '0123456789abcdef' },
    mapping: { dpId: '18', startValue: true, stopValue: false } });
  assert.equal(enabled, false);
  assert.equal(device.available, true);
  await device.listeners.evcharger_charging(true);
  assert.equal(enabled, true);
  await device.onDeleted();
});
