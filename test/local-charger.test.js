'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LocalCharger } = require('../lib/local-charger');

function cable({ state = false, changeStatus = true } = {}) {
  const writes = [];
  return {
    writes,
    client: {
      async getStatus() { return { dps: { 101: state, 102: 16 } }; },
      async setDps(dps) { writes.push(dps); if (changeStatus) state = dps[101]; },
    },
  };
}

test('local charging controls only the confirmed DP and confirms start/stop by reading the cable', async () => {
  const { client, writes } = cable();
  const charger = new LocalCharger(client, { dpId: '101', startValue: true, stopValue: false });
  assert.equal(await charger.setCharging(true), true);
  assert.equal(await charger.setCharging(false), false);
  assert.deepEqual(writes, [{ 101: true }, { 101: false }]);
});

test('guessed DPs and values with the wrong type never send a local command', async () => {
  const { client, writes } = cable();
  for (const mapping of [
    { dpId: '1', startValue: true, stopValue: false },
    { dpId: '101', startValue: 'true', stopValue: 'false' },
    { dpId: '101', startValue: true, stopValue: true },
  ]) {
    await assert.rejects(new LocalCharger(client, mapping).setCharging(true));
  }
  assert.deepEqual(writes, []);
});

test('an unconfirmed local command fails without resending the write', async () => {
  const { client, writes } = cable({ changeStatus: false });
  const charger = new LocalCharger(client, { dpId: '101', startValue: true, stopValue: false }, { wait: async () => {}, attempts: 3 });
  await assert.rejects(charger.setCharging(true), /niet bevestigd/);
  assert.equal(writes.length, 1);
});

test('inverted local switch values and concurrent start/stop calls retain the intended order', async () => {
  const { client, writes } = cable({ state: true });
  const charger = new LocalCharger(client, { dpId: '101', startValue: false, stopValue: true });
  assert.deepEqual(await Promise.all([charger.setCharging(true), charger.setCharging(false)]), [true, false]);
  assert.deepEqual(writes, [{ 101: false }, { 101: true }]);
});
