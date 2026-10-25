'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Charger } = require('../lib/charger');

function rig({ online = true, accepted = true, reported = false } = {}) {
  const commands = [];
  let state = reported;
  const cloud = {
    inspectDevice: async () => ({ info: { online }, functions: [{ code: 'example_control', type: 'Boolean', values: '{}' }], status: [{ code: 'example_control', value: state }] }),
    readDevice: async () => ({ info: { online }, status: [{ code: 'example_control', value: state }] }),
    command: async (id, code, value) => { commands.push({ id, code, value }); if (accepted) state = value; },
  };
  return { cloud, commands };
}

test('start and stop use the verified code and confirm reported state', async () => {
  const { cloud, commands } = rig();
  const charger = new Charger(cloud, 'example-device', { code: 'example_control', startValue: true, stopValue: false });
  assert.equal(await charger.setCharging(true), true);
  assert.equal(await charger.setCharging(false), false);
  assert.deepEqual(commands, [
    { id: 'example-device', code: 'example_control', value: true },
    { id: 'example-device', code: 'example_control', value: false },
  ]);
});

test('unknown functions, mismatched values and offline cables never receive commands', async () => {
  for (const scenario of [
    { online: false, mapping: { code: 'example_control', startValue: true, stopValue: false } },
    { mapping: { code: 'guessed_dp_1', startValue: true, stopValue: false } },
    { mapping: { code: 'example_control', startValue: 'true', stopValue: 'false' } },
  ]) {
    const { cloud, commands } = rig(scenario);
    const charger = new Charger(cloud, 'example-device', scenario.mapping);
    await assert.rejects(charger.setCharging(true));
    assert.deepEqual(commands, []);
  }
});

test('API acceptance without a changed report fails and never resends the command', async () => {
  const { cloud, commands } = rig({ accepted: false });
  const charger = new Charger(cloud, 'example-device', { code: 'example_control', startValue: true, stopValue: false }, { wait: async () => {}, attempts: 3 });
  await assert.rejects(charger.setCharging(true), /niet bevestigd/);
  assert.equal(commands.length, 1);
});

test('reversed boolean polarity is honored and simultaneous start/stop stay ordered', async () => {
  const { cloud, commands } = rig({ reported: true });
  const charger = new Charger(cloud, 'example-device', { code: 'example_control', startValue: false, stopValue: true });
  const result = await Promise.all([charger.setCharging(true), charger.setCharging(false)]);
  assert.deepEqual(result, [true, false]);
  assert.deepEqual(commands.map(command => command.value), [false, true]);
});

test('enum values must exist in the device schema before a command is sent', async () => {
  const { cloud, commands } = rig();
  let state = 'pause';
  cloud.inspectDevice = async () => ({
    info: { online: true },
    functions: [{ code: 'example_control', type: 'Enum', values: '{"range":["run","pause"]}' }],
    status: [{ code: 'example_control', value: state }],
  });
  cloud.readDevice = async () => ({ info: { online: true }, status: [{ code: 'example_control', value: state }] });
  cloud.command = async (id, code, value) => { commands.push(value); state = value; };
  const charger = new Charger(cloud, 'example-device', { code: 'example_control', startValue: 'run', stopValue: 'pause' });
  assert.equal(await charger.setCharging(true), true);
  const invalid = new Charger(cloud, 'example-device', { code: 'example_control', startValue: 'guessed_start', stopValue: 'pause' });
  await assert.rejects(invalid.setCharging(true), /enumwaarden/);
  assert.deepEqual(commands, ['run']);
});

test('unrecognized reported states block commands instead of guessing off', async () => {
  const { cloud, commands } = rig({ reported: 'unknown' });
  const charger = new Charger(cloud, 'example-device', { code: 'example_control', startValue: true, stopValue: false });
  await assert.rejects(charger.read(), /Onbekende laadstatus/);
  await assert.rejects(charger.setCharging(true), /Onbekende laadstatus/);
  assert.equal(commands.length, 0);
});
