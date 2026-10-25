'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const schema = require('./fixtures/voldt-schema.json').schema;
const { createTelemetryProfile, mapTelemetry } = require('../lib/charger-telemetry');

test('Voldt telemetry converts the verified product units into Homey power, energy and sensors', () => {
  const profile = createTelemetryProfile(schema);
  const values = mapTelemetry({ '1': 12345, '9': 2875, '24': 18, '4': 13, '25': 67, '3': 'charger_charging', '16': true }, profile);
  assert.deepEqual(values, { measure_power: 2875, meter_power: 123.45, measure_temperature: 18,
    measure_current_limit: 13, meter_energy_session: 0.67, charge_state: 'charger_charging' });
});

test('missing or invalid measurements stay unknown and reported zero remains zero', () => {
  const profile = createTelemetryProfile(schema);
  const values = mapTelemetry({ '1': 0, '9': 0, '24': -5, '4': '13', '3': 'unsupported-state' }, profile);
  assert.equal(values.measure_power, 0);
  assert.equal(values.meter_power, 0);
  assert.equal(values.measure_temperature, -5);
  assert.equal(values.measure_current_limit, null);
  assert.equal(values.meter_energy_session, null);
  assert.equal(values.charge_state, null);
  assert.equal(mapTelemetry({ '9': Infinity }, profile).measure_power, null);
  assert.equal(mapTelemetry({ '1': -1 }, profile).meter_power, null);
});

test('unrecognized units cannot silently create a scaled energy counter', () => {
  const changed = structuredClone(schema);
  changed.find(field => field.code === 'forward_energy_total').property.unit = 'unknown';
  assert.throws(() => createTelemetryProfile(changed), /eenheid|schaal/);
});
