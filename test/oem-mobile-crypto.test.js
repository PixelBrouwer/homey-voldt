'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, privateDecrypt, constants } = require('node:crypto');
const vector = require('./fixtures/oem-mobile-crypto-vector.json');
const { OemMobileCrypto, encryptEmailPassword } = require('../lib/oem-mobile-crypto');

const identity = { packageName: 'com.example.vendor',
  certificateSha256: '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff',
  containerSecret: '0123456789abcdef0123456789abcdef', appSecret: 'fedcba9876543210fedcba9876543210' };
const requestId = '01234567-89ab-cdef-0123-456789abcdef';
const postData = { countryCode: '31', username: 'owner@example.test', isUid: false };

test('OEM request encryption and signature match an independent JCE reference', () => {
  const crypto = new OemMobileCrypto(identity);
  const encrypted = crypto.seal(postData, { requestId, iv: Buffer.from('000102030405060708090a0b', 'hex') });
  assert.equal(encrypted, vector.encryptedPostData);
  const fields = { a: 'smartlife.m.user.username.token.get', v: '2.0', clientId: 'fixture-client',
    et: '3', postData: encrypted, requestId, time: '1792886400', ignored: 'not-signed' };
  assert.equal(crypto.sign(fields), vector.signature);
});

test('the OEM channel fingerprint uses the client ID, package and signing certificate', () => {
  const crypto = new OemMobileCrypto(identity);
  assert.equal(crypto.channelKey('fixture-client'), vector.channelKey);
  assert.match(crypto.channelKey('fixture-client'), /^[a-f0-9]{8}$/);
});

test('Fusion responses use the SID-derived key and only decompress authenticated data', () => {
  const crypto = new OemMobileCrypto(identity);
  assert.deepEqual(crypto.openResponse(vector.compressedResponse, { requestId, sid: vector.sessionSid, gzip: true, route: 'fusion' }),
    { success: true, result: { value: 42 } });
  const tampered = Buffer.from(vector.compressedResponse, 'base64');
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => crypto.openResponse(tampered.toString('base64'), { requestId, sid: vector.sessionSid, gzip: true, route: 'fusion' }), /ontsleutel/i);
});

test('Fusion outer response signatures are verified before decrypting the business response', () => {
  const crypto = new OemMobileCrypto(identity);
  const outer = { result: vector.compressedResponse, t: 1792886400, sign: vector.outerSignature };
  const options = { requestId, sid: vector.sessionSid, gzip: true, route: 'fusion' };
  assert.deepEqual(crypto.unwrapResponse(outer, options), { success: true, result: { value: 42 } });
  assert.throws(() => crypto.unwrapResponse({ ...outer, t: outer.t + 1 }, options), /handtekening/i);
  assert.deepEqual(crypto.unwrapResponse({ success: false, errorCode: 'USER_PASSWD_WRONG' }, options),
    { success: false, errorCode: 'USER_PASSWD_WRONG' });
});

test('ordinary Business responses verify with the request AES key and use account ecode', () => {
  const crypto = new OemMobileCrypto(identity);
  const outer = { result: vector.businessResponse, t: 1792886400, sign: vector.businessSignature.toUpperCase() };
  const options = { requestId, ecode: vector.businessEcode, gzip: true };
  assert.deepEqual(crypto.unwrapResponse(outer, options), { success: true, result: { value: 42 } });
  assert.throws(() => crypto.unwrapResponse(outer, { ...options, ecode: 'wrong-ecode' }), /handtekening/i);
});

test('email password RSA uses the lowercase UTF-8 MD5 and PKCS1 v1.5 padding', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const token = { publicKey: BigInt(`0x${Buffer.from(jwk.n, 'base64url').toString('hex')}`).toString(),
    exponent: BigInt(`0x${Buffer.from(jwk.e, 'base64url').toString('hex')}`).toString() };
  const encrypted = encryptEmailPassword('pässwörd', token);
  assert.match(encrypted, /^[a-f0-9]{512}$/);
  const block = privateDecrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, Buffer.from(encrypted, 'hex'));
  assert.equal(block[0], 0);
  assert.equal(block[1], 2);
  const separator = block.indexOf(0, 2);
  assert.ok(separator >= 10);
  assert.equal(block.subarray(separator + 1).toString('ascii'), '12841e4ba5e37d2fbfc78458c6714ade');
});
