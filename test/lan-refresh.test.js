'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const { once } = require('node:events');
const { createHmac } = require('node:crypto');
const { TuyaLanClient } = require('../lib/tuya-lan-client');
const { encodePacket, decodePacket, readHeader, deriveSessionKey } = require('../lib/tuya-lan-codec');

async function cable(t, version, onRefresh, timeoutMs = 150) {
  const key = Buffer.from('0123456789abcdef');
  const sockets = new Set();
  const commands = [];
  const errors = [];
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', error => errors.push(error));
    let pending = Buffer.alloc(0);
    let sessionKey = key;
    let nonce;
    const remoteNonce = Buffer.from('abcdef0123456789');
    const frame = (command, payload) => encodePacket({ version, key: sessionKey,
      sequence: 123456, command, payload, returnCode: 0 });
    socket.on('data', chunk => {
      try {
        pending = Buffer.concat([pending, chunk]);
        while (true) {
          const header = readHeader(pending);
          if (!header || pending.length < header.totalLength) return;
          const packet = decodePacket(pending.subarray(0, header.totalLength),
            { version, key: sessionKey, expectReturnCode: false });
          pending = pending.subarray(header.totalLength);
          commands.push(packet.command);
          if (packet.command === 3) {
            nonce = packet.payload;
            socket.write(frame(4, Buffer.concat([remoteNonce, createHmac('sha256', key).update(nonce).digest()])));
          } else if (packet.command === 5) {
            assert.deepEqual(packet.payload, createHmac('sha256', key).update(remoteNonce).digest());
            sessionKey = deriveSessionKey(key, nonce, remoteNonce, version);
          } else if (packet.command === 18) {
            onRefresh({ request: JSON.parse(packet.payload.toString()), socket, frame });
          } else throw new Error(`Unexpected command ${packet.command}`);
        }
      } catch (error) { errors.push(error); socket.destroy(); }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  const client = new TuyaLanClient({ host: '127.0.0.1', deviceId: 'test-device', localKey: key,
    version, timeoutMs, port: server.address().port });
  return { client, commands, errors };
}

test('LAN 3.5 refresh requests numeric DP IDs and merges asynchronous partial reports without control commands', async t => {
  const { client, commands, errors } = await cable(t, '3.5', ({ request, socket, frame }) => {
    assert.deepEqual(request, { dpId: [25, 5, 6] });
    socket.write(Buffer.concat([
      frame(18, Buffer.alloc(0)),
      frame(8, { data: { dps: { '5': 1234 } } }),
      frame(8, { data: { dps: { '6': 'AAAAAA==' } } }),
      frame(8, { data: { dps: { '25': 42 } } }),
    ]));
  });
  const status = await client.refreshDps([25, 5, 6]);
  assert.deepEqual(status.dps, { '5': 1234, '6': 'AAAAAA==', '25': 42 });
  assert.deepEqual(commands, [3, 5, 18]);
  assert.deepEqual(errors, []);
});

test('refresh framing matches fixed upstream vectors for 3.3, 3.4 and 3.5 without a version header', () => {
  const fixture = require('./fixtures/tuya-lan-refresh-vectors.json');
  for (const vector of fixture.vectors) {
    const frame = encodePacket({ version: vector.version, key: vector.key, sequence: vector.sequence,
      command: vector.command, payload: vector.data,
      ...(vector.version === '3.5' ? { iv: Buffer.from('170000000012') } : {}) });
    assert.equal(frame.toString('hex'), vector.hex);
  }
});

for (const version of ['3.3', '3.4']) {
  test(`LAN ${version} refresh remains a read-only command 18 request`, async t => {
    const { client, commands, errors } = await cable(t, version, ({ request, socket, frame }) => {
      assert.deepEqual(request, { dpId: [25] });
      socket.write(frame(8, { dps: { '25': 42 } }));
    });
    assert.deepEqual((await client.refreshDps([25])).dps, { '25': 42 });
    assert.deepEqual(commands, version === '3.3' ? [18] : [3, 5, 18]);
    assert.deepEqual(errors, []);
  });
}

test('an ACK without changed values returns ACK within one second and does not invent energy', async t => {
  const { client, commands } = await cable(t, '3.5', ({ socket, frame }) => {
    socket.write(frame(18, Buffer.alloc(0)));
  }, 5000);
  const start = Date.now();
  const status = await client.refreshDps([25, 5, 6]);
  assert.deepEqual(status, { acknowledged: true });
  assert.ok(Date.now() - start < 2000, 'an ACK must not occupy the full five-second status timeout');
  assert.deepEqual(commands, [3, 5, 18]);
});

test('partial refresh data remains partial when the cable closes after reporting', async t => {
  const { client, commands } = await cable(t, '3.5', ({ socket, frame }) => {
    socket.end(Buffer.concat([frame(8, { dps: { '5': 1234 } }), frame(18, Buffer.alloc(0))]));
  });
  const status = await client.refreshDps([25, 5, 6]);
  assert.deepEqual(status.dps, { '5': 1234 });
  assert.equal(Object.hasOwn(status.dps, '25'), false);
  assert.equal(Object.hasOwn(status.dps, '6'), false);
  assert.deepEqual(commands, [3, 5, 18]);
});

test('a refresh with no response times out and is never retried as a control command', async t => {
  const { client, commands } = await cable(t, '3.5', () => {});
  await assert.rejects(client.refreshDps([25]), { code: 'TUYA_LAN_TIMEOUT' });
  assert.deepEqual(commands, [3, 5, 18]);
});

test('an authenticated ACK does not hide a later invalid status authentication tag', async t => {
  const { client, commands } = await cable(t, '3.5', ({ socket, frame }) => {
    const report = frame(8, { dps: { '25': 42 } });
    report[report.length - 5] ^= 1;
    socket.write(Buffer.concat([frame(18, Buffer.alloc(0)), report]));
  });
  await assert.rejects(client.refreshDps([25]), /authenticatie/);
  assert.deepEqual(commands, [3, 5, 18]);
});

test('refresh accepts only nonempty numeric DP lists within 1 through 255', async () => {
  const client = new TuyaLanClient({ host: '127.0.0.1', deviceId: 'test-device',
    localKey: '0123456789abcdef', version: '3.5', port: 9, timeoutMs: 100 });
  for (const value of [null, [], ['25'], [0], [256], [1.5], [NaN], [true]]) {
    await assert.rejects(client.refreshDps(value), /numerieke DP-ID/);
  }
});
