'use strict';

const Homey = require('homey');
const { TuyaCloud } = require('../../lib/tuya-cloud');
const { Charger } = require('../../lib/charger');
const { TuyaLanClient } = require('../../lib/tuya-lan-client');
const { LocalCharger } = require('../../lib/local-charger');
const { TELEMETRY_CAPABILITIES } = require('../../lib/charger-telemetry');
const friendlyError = require('../../lib/friendly-error');

module.exports = class VoldtDevice extends Homey.Device {
  async onInit() {
    this.deleted = false;
    this.operations = Promise.resolve();
    this.registerCapabilityListener('evcharger_charging', value => this.enqueue(async () => {
      try {
        if (!this.charger) throw friendlyError(this.homey, { code: 'SETUP_REQUIRED' });
        await this.charger.setCharging(value);
        await this.setAvailable();
        // Homey commits the capability after this listener resolves successfully.
      } catch (error) {
        const shown = this.runtimeError(error);
        await this.setUnavailable(shown.message);
        throw shown;
      }
    }));
    await this.ensureTelemetryCapabilities();
    if (this.getStoreValue('setupTicket')) {
      try {
        const prepared = this.driver.takeSetupTicket(this.getStoreValue('setupTicket'), this.getData().id);
        await this.setStoreValue('localConnection', prepared.connection);
        await this.setStoreValue('localMapping', prepared.mapping);
        await this.setStoreValue('localTelemetry', prepared.telemetryProfile);
        await this.setStoreValue('localTarget', { host: prepared.connection.host, deviceId: prepared.connection.deviceId, version: prepared.connection.version });
        await this.setStoreValue('connectionType', 'local');
        await this.setStoreValue('pendingSetup', false);
        await this.unsetStoreValue('setupTicket');
      } catch {
        await this.setUnavailable(this.homey.__ ? this.homey.__('errors.SESSION_EXPIRED') : 'Pairing expired. Sign in again through app settings.');
        return;
      }
    }
    if (this.getStoreValue('pendingSetup') === true) {
      if (this.getStoreValue('localConnection')?.localKey) {
        await this.setUnavailable(friendlyError(this.homey, { code: 'SETUP_CONFIRM' }).message);
        return;
      }
      await this.setUnavailable(friendlyError(this.homey, { code: 'NOT_PAIRED' }).message);
      return;
    }
    try {
      this.charger = this.getStoreValue('connectionType') === 'local'
        ? new LocalCharger(new TuyaLanClient(this.getStoreValue('localConnection') || {}), this.getStoreValue('localMapping'),
          { telemetryProfile: this.getStoreValue('localTelemetry') })
        : new Charger(new TuyaCloud(this.getStoreValue('auth') || {}),
          this.getStoreValue('deviceId') || this.getData().id, this.getStoreValue('mapping'));
    } catch (error) {
      await this.setUnavailable(this.runtimeError(error).message);
      return;
    }
    await this.enqueue(() => this.poll());
    this.schedule();
  }

  async configure({ auth, deviceId, mapping }) {
    return this.enqueue(async () => {
      const charger = new Charger(new TuyaCloud(auth), deviceId, mapping);
      const enabled = await charger.read();
      await this.setStoreValue('auth', auth);
      await this.setStoreValue('mapping', mapping);
      await this.setStoreValue('deviceId', deviceId);
      await this.setStoreValue('pendingSetup', false);
      await this.setStoreValue('connectionType', 'cloud');
      if (this.timer) this.homey.clearTimeout(this.timer);
      this.charger = charger;
      await this.setCapabilityValue('evcharger_charging', enabled);
      await this.setAvailable();
      this.schedule();
    });
  }

  async configureLocal({ connection, mapping, telemetryProfile = this.getStoreValue('localTelemetry') }) {
    return this.enqueue(async () => {
      const charger = new LocalCharger(new TuyaLanClient(connection), mapping, { telemetryProfile });
      const snapshot = await charger.readSnapshot();
      await this.setStoreValue('localConnection', connection);
      await this.setStoreValue('localMapping', mapping);
      if (telemetryProfile) await this.setStoreValue('localTelemetry', telemetryProfile);
      await this.setStoreValue('localTarget', { host: connection.host, deviceId: connection.deviceId, version: connection.version });
      await this.setStoreValue('connectionType', 'local');
      await this.setStoreValue('pendingSetup', false);
      if (this.timer) this.homey.clearTimeout(this.timer);
      this.charger = charger;
      await this.ensureTelemetryCapabilities();
      await this.applySnapshot(snapshot);
      await this.setAvailable();
      this.schedule();
    });
  }

  enqueue(operation) {
    const pending = this.operations.then(() => this.deleted ? undefined : operation());
    this.operations = pending.catch(() => {});
    return pending;
  }

  runtimeError(error) {
    if (error.code === 'SETUP_REQUIRED' || this.getStoreValue('connectionType') !== 'local') return error;
    return friendlyError(this.homey, { code: error.code === 'TUYA_LAN_UNCONFIRMED' ? 'CHARGE_UNCONFIRMED' : 'LOCAL_UNAVAILABLE' });
  }

  async ensureTelemetryCapabilities() {
    for (const capability of TELEMETRY_CAPABILITIES) {
      if (!this.hasCapability(capability)) await this.addCapability(capability);
    }
  }

  async applySnapshot(snapshot) {
    await this.setCapabilityValue('evcharger_charging', snapshot.enabled);
    for (const [capability, value] of Object.entries(snapshot.telemetry || {})) {
      await this.setCapabilityValue(capability, value);
    }
  }

  async poll() {
    try {
      const snapshot = this.charger.readSnapshot ? await this.charger.readSnapshot() : { enabled: await this.charger.read() };
      if (this.deleted) return;
      await this.applySnapshot(snapshot);
      await this.setAvailable();
    } catch (error) {
      if (!this.deleted) await this.setUnavailable(this.runtimeError(error).message);
    }
  }

  schedule() {
    if (this.deleted) return;
    const seconds = Math.min(3600, Math.max(10, Number(this.getSetting('poll_interval')) || 15));
    this.timer = this.homey.setTimeout(() => {
      this.enqueue(() => this.poll()).catch(() => {}).finally(() => this.schedule());
    }, seconds * 1000);
  }

  async onDeleted() {
    this.deleted = true;
    if (this.timer) this.homey.clearTimeout(this.timer);
  }
};
