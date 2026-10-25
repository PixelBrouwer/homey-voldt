'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCipheriv, createDecipheriv } = require('node:crypto');
const { decode, query, DISCOVERY_KEY, crc32, announcementSummary } = require('../lib/tuya-lan-discovery');

test('announcement diagnostics report complete field names without exposing unknown credentials', () => {
  const summary = announcementSummary({ ip: '192.168.1.50', active: 2, encrypt: true,
    localKey: 'sensitive-device-key', token: 'sensitive-token', nested: { secret: 'sensitive-other' } });
  assert.deepEqual(summary.fields, ['active', 'encrypt', 'ip', 'localKey', 'nested', 'token']);
  assert.deepEqual(summary.metadata, { ip: '192.168.1.50', active: 2, encrypt: true });
  assert.deepEqual(summary.fieldTypes.localKey, { type: 'string', bytes: 20 });
  assert.deepEqual(summary.fieldTypes.encrypt, { type: 'boolean' });
  assert.equal(JSON.stringify(summary).includes('sensitive-'), false);
});

test('UDP discovery solicits device information rather than writing a DP', () => {
  const frame = query('192.168.1.2', Buffer.alloc(12, 4));
  assert.equal(frame.readUInt32BE(0), 0x6699);
  assert.equal(frame.readUInt32BE(10), 0x25);
  const decipher = createDecipheriv('aes-128-gcm', DISCOVERY_KEY, frame.subarray(18, 30));
  decipher.setAAD(frame.subarray(4, 18));
  decipher.setAuthTag(frame.subarray(-20, -4));
  const data = Buffer.concat([decipher.update(frame.subarray(30, -20)), decipher.final()]);
  assert.deepEqual(JSON.parse(data), { from: 'app', ip: '192.168.1.2' });
  assert.equal(decode(frame), null);
});

test('discovery decodes 3.5 announcements and rejects altered authentication tags', () => {
  const json = Buffer.from(JSON.stringify({ ip: '192.168.1.50', gwId: 'example-device', version: '3.5' }));
  const header = Buffer.alloc(18);
  header.writeUInt32BE(0x6699, 0);
  header.writeUInt32BE(0x25, 10);
  header.writeUInt32BE(12 + json.length + 16, 14);
  const iv = Buffer.alloc(12, 9);
  const cipher = createCipheriv('aes-128-gcm', DISCOVERY_KEY, iv);
  cipher.setAAD(header.subarray(4));
  const frame = Buffer.concat([header, iv, cipher.update(json), cipher.final(), cipher.getAuthTag(), Buffer.from('00009966', 'hex')]);
  assert.deepEqual(decode(frame), { ip: '192.168.1.50', gwId: 'example-device', version: '3.5' });
  frame[frame.length - 5] ^= 1;
  assert.equal(decode(frame), null);
});

test('legacy discovery verifies CRC before accepting device information', () => {
  const data = Buffer.from(JSON.stringify({ ip: '192.168.1.50', gwId: 'example-device', version: '3.3' }));
  const frame = Buffer.alloc(16 + 4 + data.length + 8);
  frame.writeUInt32BE(0x55aa, 0);
  frame.writeUInt32BE(4 + data.length + 8, 12);
  data.copy(frame, 20);
  frame.writeUInt32BE(crc32(frame.subarray(0, -8)), frame.length - 8);
  frame.writeUInt32BE(0xaa55, frame.length - 4);
  assert.equal(decode(frame).version, '3.3');
  frame[25] ^= 1;
  assert.equal(decode(frame), null);
});
