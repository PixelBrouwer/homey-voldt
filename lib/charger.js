'use strict';

const { setTimeout: sleep } = require('node:timers/promises');

function validateMapping(mapping, functions) {
  if (!mapping || typeof mapping.code !== 'string' || !mapping.code.trim()) {
    throw new Error('Kies eerst de geverifieerde laadfunctie.');
  }
  if (mapping.startValue === mapping.stopValue) throw new Error('Start- en stopwaarde moeten verschillen.');
  const fn = functions.find(item => item.code === mapping.code);
  if (!fn) throw new Error('Laadfunctie ontbreekt in het schrijfbare apparaatschema.');
  const type = String(fn.type).toLowerCase();
  if (type === 'boolean' || type === 'bool') {
    if (typeof mapping.startValue !== 'boolean' || typeof mapping.stopValue !== 'boolean') {
      throw new Error('Deze laadfunctie vereist booleans.');
    }
  } else if (type === 'enum') {
    let range;
    try { range = (typeof fn.values === 'string' ? JSON.parse(fn.values) : fn.values)?.range; } catch { /* rejected below */ }
    if (!Array.isArray(range) || !range.includes(mapping.startValue) || !range.includes(mapping.stopValue)) {
      throw new Error('Start- of stopwaarde ontbreekt in de toegestane enumwaarden.');
    }
  } else {
    throw new Error('Alleen geverifieerde boolean- en enum-laadfuncties worden ondersteund.');
  }
  return { code: mapping.code, startValue: mapping.startValue, stopValue: mapping.stopValue };
}

class Charger {
  constructor(cloud, deviceId, mapping, { wait = sleep, attempts = 5, interval = 1500 } = {}) {
    this.cloud = cloud;
    this.deviceId = deviceId;
    this.mapping = mapping;
    this.wait = wait;
    this.attempts = attempts;
    this.interval = interval;
    this.queue = Promise.resolve();
  }

  decode({ info, status }) {
    if (info?.online !== true) throw new Error('Laadkabel is offline; status niet bevestigd.');
    if (!Array.isArray(status)) throw new Error('Laadstatus ontbreekt.');
    const entry = status.find(item => item.code === this.mapping.code);
    if (!entry) throw new Error('Gekozen laadfunctie wordt niet teruggerapporteerd.');
    if (entry.value === this.mapping.startValue) return true;
    if (entry.value === this.mapping.stopValue) return false;
    throw new Error('Onbekende laadstatus; controleer de functiemapping.');
  }

  async read() {
    return this.decode(await this.cloud.readDevice(this.deviceId));
  }

  setCharging(enabled) {
    const operation = this.queue.then(() => this.apply(enabled));
    this.queue = operation.catch(() => {});
    return operation;
  }

  async apply(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Laadopdracht vereist true of false.');
    const snapshot = await this.cloud.inspectDevice(this.deviceId);
    this.mapping = validateMapping(this.mapping, snapshot.functions);
    if (this.decode(snapshot) === enabled) return enabled;
    await this.cloud.command(this.deviceId, this.mapping.code,
      enabled ? this.mapping.startValue : this.mapping.stopValue);
    for (let attempt = 0; attempt < this.attempts; attempt++) {
      if (attempt > 0) await this.wait(this.interval);
      if (await this.read() === enabled) return enabled;
    }
    throw new Error('Laadopdracht geaccepteerd, maar gewijzigde status niet bevestigd.');
  }
}

module.exports = { Charger, validateMapping };
