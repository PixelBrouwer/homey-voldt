'use strict';

const FIELDS = {
  measure_power: { code: 'power_total', units: { W: 1, kW: 1000 } },
  meter_power: { code: 'forward_energy_total', units: { kWh: 1, 'kW·h': 1 } },
  measure_temperature: { code: 'temp_current', units: { '℃': 1, '°C': 1, C: 1 } },
  measure_current_limit: { code: 'charge_cur_set', units: { A: 1 } },
  meter_energy_session: { code: 'charge_energy_once', units: { kWh: 1, 'kW·h': 1 } },
  charge_state: { code: 'work_state', type: 'enum' },
};
const TELEMETRY_CAPABILITIES = Object.keys(FIELDS);

function createTelemetryProfile(schema) {
  if (typeof schema === 'string') schema = JSON.parse(schema);
  if (!Array.isArray(schema)) throw new Error('Een bevestigd Voldt-productschema is vereist.');
  const profile = {};
  for (const [capability, spec] of Object.entries(FIELDS)) {
    const matches = schema.filter(field => field.code === spec.code);
    if (!matches.length) continue;
    if (matches.length !== 1) throw new Error('Het productschema bevat een dubbelzinnige meetwaarde.');
    const field = matches[0];
    if (!/^[1-9][0-9]{0,2}$/.test(String(field.id)) || Number(field.id) > 255 || !['ro', 'rw'].includes(field.mode)) {
      throw new Error('Ongeldige meet-DP in het productschema.');
    }
    const property = typeof field.property === 'string' ? JSON.parse(field.property) : field.property;
    if (spec.type === 'enum') {
      if (property?.type !== 'enum' || !Array.isArray(property.range) || !property.range.every(value => typeof value === 'string')) {
        throw new Error('Ongeldige laadstatusdefinitie in het productschema.');
      }
      profile[capability] = { dpId: String(field.id), type: 'enum', range: property.range };
    } else {
      const factor = spec.units[property?.unit];
      const scale = property?.scale ?? 0;
      if (property?.type !== 'value' || factor === undefined || !Number.isInteger(scale) || scale < 0 || scale > 6) {
        throw new Error('Onbekende eenheid of schaal in het productschema.');
      }
      profile[capability] = { dpId: String(field.id), type: 'number', scale, factor, allowNegative: property.min < 0 };
    }
  }
  if (!Object.keys(profile).length) throw new Error('Dit productschema bevat geen ondersteunde laadmetingen.');
  return profile;
}

function mapTelemetry(dps, profile) {
  const values = {};
  for (const [capability, field] of Object.entries(profile || {})) {
    const raw = dps?.[field.dpId];
    if (field.type === 'enum') values[capability] = typeof raw === 'string' && field.range.includes(raw) ? raw : null;
    else values[capability] = typeof raw === 'number' && Number.isFinite(raw) && (field.allowNegative || raw >= 0)
      ? Number((raw * field.factor / (10 ** field.scale)).toFixed(6)) : null;
  }
  return values;
}

module.exports = { TELEMETRY_CAPABILITIES, createTelemetryProfile, mapTelemetry };
