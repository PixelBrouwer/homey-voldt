'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TuyaCloud } = require('../lib/tuya-cloud');

test('reads device schema and status with signed requests and one shared token', async () => {
  const calls = [];
  const client = new TuyaCloud({
    endpoint: 'https://openapi.tuyaeu.com', clientId: 'test-client', clientSecret: 'test-secret',
    now: () => 1700000000000,
    fetch: async (url, options) => {
      calls.push({ url, ...options });
      const path = new URL(url).pathname;
      let result;
      if (path === '/v1.0/token') result = { access_token: 'test-token', expire_time: 7200 };
      else if (path.endsWith('/functions')) result = { functions: [{ code: 'example_control', type: 'Boolean', values: '{}' }] };
      else if (path.endsWith('/status')) result = [{ code: 'example_control', value: false }];
      else result = { name: 'Test cable', online: true };
      return { ok: true, json: async () => ({ success: true, result }) };
    },
  });
  const device = await client.inspectDevice('example-device');
  assert.equal(device.info.online, true);
  assert.equal(device.functions[0].code, 'example_control');
  assert.equal(device.status[0].value, false);
  assert.equal(calls.filter(call => call.url.includes('/token?')).length, 1);
  // Fixed vector independently calculated from Tuya's documented HMAC formula.
  assert.equal(calls[0].headers.sign, '1A2AD60FCA3C359C4A43D7B8AD76791238DE5D8D11BEFA6C6BFCD07440693BF4');
  for (const call of calls.slice(1)) {
    assert.equal(call.headers.access_token, 'test-token');
    assert.match(call.headers.sign, /^[A-F0-9]{64}$/);
  }
});

test('cloud rejection does not get retried or leak response secrets', async () => {
  let commands = 0;
  const client = new TuyaCloud({
    endpoint: 'https://openapi.tuyaeu.com', clientId: 'test-client', clientSecret: 'test-secret',
    fetch: async url => {
      if (new URL(url).pathname === '/v1.0/token') {
        return { ok: true, json: async () => ({ success: true, result: { access_token: 'test-token', expire_time: 7200 } }) };
      }
      commands++;
      return { ok: true, json: async () => ({ success: false, code: 1106, msg: 'private-token-do-not-log' }) };
    },
  });
  await assert.rejects(client.command('example-device', 'example_control', true), error => {
    assert.match(error.message, /1106/);
    assert.doesNotMatch(error.message, /private-token/);
    return true;
  });
  assert.equal(commands, 1);
});

test('arbitrary endpoints and device paths are rejected before any network request', async () => {
  let calls = 0;
  const options = { clientId: 'test-client', clientSecret: 'test-secret', fetch: async () => { calls++; } };
  assert.throws(() => new TuyaCloud({ ...options, endpoint: 'https://example.invalid' }));
  const client = new TuyaCloud({ ...options, endpoint: 'https://openapi.tuyaeu.com' });
  await assert.rejects(client.inspectDevice('../token?grant_type=1'));
  assert.equal(calls, 0);
});

test('a malformed cloud reply never exposes its response body in an error', async () => {
  const client = new TuyaCloud({
    endpoint: 'https://openapi.tuyaeu.com', clientId: 'test-client', clientSecret: 'test-secret',
    fetch: async () => ({ ok: true, json: async () => { throw new SyntaxError('private-response-content'); } }),
  });
  await assert.rejects(client.inspectDevice('example-device'), error => {
    assert.match(error.message, /ongeldig antwoord/);
    assert.doesNotMatch(error.message, /private-response/);
    return true;
  });
});
