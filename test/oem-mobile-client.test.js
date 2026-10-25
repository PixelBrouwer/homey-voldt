'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, privateDecrypt, constants } = require('node:crypto');
const { OemMobileCrypto } = require('../lib/oem-mobile-crypto');
const { OemMobileClient } = require('../lib/oem-mobile-client');

const identity = { packageName: 'com.example.vendor',
  certificateSha256: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
  containerSecret: '0123456789abcdef0123456789abcdef', appSecret: 'fedcba9876543210fedcba9876543210' };

test('email login obtains only the requested device key using the OEM mobile API', async () => {
  const crypto = new OemMobileCrypto(identity);
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const token = { publicKey: BigInt(`0x${Buffer.from(jwk.n, 'base64url').toString('hex')}`).toString(),
    exponent: BigInt(`0x${Buffer.from(jwk.e, 'base64url').toString('hex')}`).toString(), token: 'fixture-token' };
  const sid = 'fixture-session-id-0123456789';
  const ecode = 'fixture-ecode';
  const actions = [];
  const client = new OemMobileClient({ clientId: 'fixture-client', crypto, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://a1.tuyaeu.com/api.json');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.match(options.headers['content-type'], /application\/x-www-form-urlencoded/);
    assert.equal(options.body.includes('pässwörd'), false);
    const fields = Object.fromEntries(new URLSearchParams(options.body));
    assert.equal(fields.sign, crypto.sign(fields));
    assert.equal(fields.clientId, 'fixture-client');
    assert.equal(fields.et, '3');
    assert.equal(fields.chKey, crypto.channelKey('fixture-client'));
    const data = crypto.openResponse(fields.postData, { requestId: fields.requestId, ecode: actions.length >= 2 ? ecode : '' });
    actions.push(fields.a);
    let result;
    if (actions.length === 1) {
      assert.equal(fields.a, 'smartlife.m.user.username.token.get');
      assert.equal(fields.v, '2.0');
      assert.equal(fields.sid, undefined);
      assert.deepEqual(data, { countryCode: '31', username: 'owner@example.test', isUid: false });
      result = token;
    } else if (actions.length === 2) {
      assert.equal(fields.a, 'smartlife.m.user.email.password.login');
      assert.equal(fields.v, '3.0');
      assert.equal(fields.sid, undefined);
      assert.equal(data.email, 'owner@example.test');
      assert.equal(data.options, '{"group": 1}');
      assert.equal(data.ifencrypt, 1);
      assert.equal(data.token, token.token);
      const block = privateDecrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, Buffer.from(data.passwd, 'hex'));
      assert.equal(block.subarray(block.indexOf(0, 2) + 1).toString(), '12841e4ba5e37d2fbfc78458c6714ade');
      result = { sid, ecode, domain: { mobileApiUrl: 'https://a1.tuyaeu.com' } };
    } else if (actions.length === 3) {
      assert.equal(fields.a, 'smartlife.m.device.key.get');
      assert.equal(fields.sid, sid);
      assert.deepEqual(data, { gwId: 'fixture-device' });
      result = [{ devId: 'another-device', localKey: 'other-secret-key' },
        { devId: 'fixture-device', localKey: '0123456789abcdef' }];
    } else if (actions.length === 4) {
      assert.equal(fields.a, 'smartlife.m.device.get');
      assert.equal(fields.v, '4.1');
      assert.deepEqual(data, { devId: 'fixture-device' });
      result = { devId: 'fixture-device', productId: 'fixture-product', productVer: '1.0' };
    } else {
      assert.equal(fields.a, 'smartlife.m.device.ref.info.list');
      assert.equal(fields.v, '6.1');
      assert.deepEqual(JSON.parse(data.productIds), [{ pid: 'fixture-product', ver: '1.0' }]);
      assert.equal(data.zigbeeGroup, true);
      result = [{ id: 'fixture-product', schemaInfo: { schema: '[{"id":16,"code":"fixture_charge_switch","mode":"rw"}]' } }];
    }
    return Response.json({ success: true, result });
  } });
  assert.deepEqual(await client.login({ email: 'owner@example.test', password: 'pässwörd', countryCode: '31' }), { authenticated: true });
  assert.equal(await client.getDeviceKey('fixture-device'), '0123456789abcdef');
  const metadata = await client.inspectDevice('fixture-device');
  assert.equal(metadata.device.productId, 'fixture-product');
  assert.equal(metadata.products[0].id, 'fixture-product');
  assert.equal(actions.length, 5);
  assert.equal(JSON.stringify(client).includes(sid), false);
});

test('account errors stop the login and never expose the server response or password', async () => {
  let requests = 0;
  const client = new OemMobileClient({ clientId: 'fixture-client', crypto: new OemMobileCrypto(identity),
    fetchImpl: async () => { requests++; return Response.json({ success: false, errorCode: 'USER_PASSWD_WRONG',
      errorMsg: 'sensitive-server-body-and-password' }); } });
  await assert.rejects(client.getDeviceKey('fixture-device'), { code: 'OEM_NOT_LOGGED_IN' });
  assert.equal(requests, 0);
  await assert.rejects(client.login({ email: 'owner@example.test', password: 'secret' }), error => {
    assert.equal(error.code, 'USER_PASSWD_WRONG');
    assert.equal(error.message.includes('sensitive-'), false);
    assert.equal(error.message.includes('secret'), false);
    return true;
  });
  assert.equal(requests, 1);
});
