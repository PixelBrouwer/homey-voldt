'use strict';

const { setTimeout: sleep } = require('node:timers/promises');
const { mapTelemetry } = require('./charger-telemetry');

function validateLocalMapping(mapping, dps) {
  if (!mapping || !/^[1-9][0-9]{0,2}$/.test(String(mapping.dpId)) || Number(mapping.dpId) > 255) {
    throw new Error('Selecteer een bevestigde laad-DP uit de uitgelezen apparaatstatus.');
  }
  const dpId = String(mapping.dpId);
  if (!dps || !Object.hasOwn(dps, dpId)) throw new Error('De gekozen laad-DP ontbreekt in de actuele status.');
  const { startValue, stopValue } = mapping;
  if (startValue === stopValue) throw new Error('Start- en stopwaarde moeten verschillen.');
  const type = typeof dps[dpId];
  if (!['boolean', 'string', 'number'].includes(type)
      || typeof startValue !== type || typeof stopValue !== type
      || (type === 'number' && (!Number.isFinite(startValue) || !Number.isFinite(stopValue)))
      || (type === 'string' && (startValue.length > 128 || stopValue.length > 128))) {
    throw new Error('De start- en stopwaarde moeten hetzelfde gegevenstype hebben als de gerapporteerde DP.');
  }
  return { dpId, startValue, stopValue };
}

class LocalCharger {
  constructor(client, mapping, { wait = sleep, attempts = 5, interval = 1000, telemetryProfile } = {}) {
    this.client = client;
    this.mapping = mapping;
    this.wait = wait;
    this.attempts = attempts;
    this.interval = interval;
    this.telemetryProfile = telemetryProfile;
    this.queue = Promise.resolve();
  }

  decode(dps) {
    const value = dps?.[this.mapping.dpId];
    if (value === this.mapping.startValue) return true;
    if (value === this.mapping.stopValue) return false;
    throw new Error('Laadinstelling niet bevestigd; de lokale DP heeft een onbekende waarde.');
  }

  async read() {
    return (await this.readSnapshot()).enabled;
  }

  async readSnapshot() {
    const status = await this.client.getStatus();
    return { enabled: this.decode(status.dps), telemetry: mapTelemetry(status.dps, this.telemetryProfile) };
  }

  setCharging(enabled) {
    const operation = this.queue.then(async () => {
      if (typeof enabled !== 'boolean') throw new Error('Laadopdracht vereist true of false.');
      const status = await this.client.getStatus();
      this.mapping = validateLocalMapping(this.mapping, status.dps);
      if (this.decode(status.dps) === enabled) return enabled;
      await this.client.setDps({ [this.mapping.dpId]: enabled ? this.mapping.startValue : this.mapping.stopValue });
      for (let attempt = 0; attempt < this.attempts; attempt++) {
        if (attempt > 0) await this.wait(this.interval);
        if (await this.read() === enabled) return enabled;
      }
      throw Object.assign(new Error('Lokale laadopdracht verstuurd, maar gewijzigde instelling niet bevestigd.'), { code: 'TUYA_LAN_UNCONFIRMED' });
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}

module.exports = { LocalCharger, validateLocalMapping };
