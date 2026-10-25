'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { Onboarding } = require('../lib/onboarding');
const api = require('../api');
const schema = require('./fixtures/voldt-schema.json').schema;

function broker() {
  return new Onboarding({ createAccount: () => ({ login: async () => {},
    inspectDevice: async id => ({ device: { name: id, productId: 'p', localKey: '0123456789abcdef' },
      products: [{ id: 'p', schemaInfo: { schema } }] }) }),
    discover: async () => ({ devices: ['existing', 'new-cable'].map(deviceId => ({ host: '192.168.1.50', deviceId, version: '3.5' })) }),
    createLan: () => ({ getStatus: async () => ({ dps: { '18': false } }) }) });
}
function driverClass() {
  const filename = path.resolve(__dirname, '../drivers/voldt/driver.js');
  const nativeRequire = createRequire(filename), module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(
    name => name === 'homey' ? { Driver: class {} } : nativeRequire(name), module, module.exports);
  return module.exports;
}

test('native pairing filters an existing physical cable and sends only a redeemable opaque ticket to the frontend', async () => {
  const onboarding = broker(), Driver = driverClass(), driver = new Driver(), handlers = {};
  driver.homey = { app: { onboarding } };
  driver.getDevices = () => [{ getStoreValue: key => key === 'localConnection' ? { deviceId: 'existing' } : undefined }];
  try {
    await driver.onPair({ setHandler: (key, fn) => { handlers[key] = fn; } });
    assert.deepEqual(await handlers.account_login({ email: 'owner@example.test', password: 'secret' }), { found: 1, alreadyAdded: false });
    const list = await handlers.list_devices();
    assert.equal(list.length, 1);
    assert.equal(list[0].data.id, 'new-cable');
    assert.doesNotMatch(JSON.stringify(list), /0123456789abcdef|password|localKey/);
    await handlers.disconnect();
    assert.equal(driver.takeSetupTicket(list[0].store.setupTicket, 'new-cable').mapping.dpId, '18');
  } finally { onboarding.close(); }
});

test('account settings reconnect only the same physical device and never return its prepared key', async () => {
  const onboarding = broker();
  let configured;
  const device = { getData: () => ({ id: 'legacy-homey-uuid' }),
    getStoreValue: key => key === 'localConnection' ? { deviceId: 'existing' } : undefined,
    configureLocal: async prepared => { configured = prepared; } };
  const homey = { app: { onboarding }, drivers: { getDriver: () => ({ getDevices: () => [device] }) } };
  try {
    const { token } = await api.accountLogin({ homey, body: { email: 'owner@example.test', password: 'secret' } });
    const found = await api.accountFind({ homey, body: { token, deviceKey: 'legacy-homey-uuid' } });
    assert.deepEqual(found.devices.map(item => item.id), ['existing']);
    await assert.rejects(api.accountConfigure({ homey, body: { token, deviceKey: 'legacy-homey-uuid', id: 'new-cable' } }), { code: 'INPUT' });
    assert.equal(configured, undefined);
    const result = await api.accountConfigure({ homey, body: { token, deviceKey: 'legacy-homey-uuid', id: 'existing' } });
    assert.deepEqual(result, { configured: true });
    assert.equal(configured.connection.localKey, '0123456789abcdef');
    assert.throws(() => onboarding.getPrepared(token, 'existing'), { code: 'SESSION_EXPIRED' });
  } finally { onboarding.close(); }
});
