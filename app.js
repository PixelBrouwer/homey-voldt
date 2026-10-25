'use strict';

const Homey = require('homey');
const { Onboarding } = require('./lib/onboarding');
const createAccount = require('./lib/voldt-account');
const { discover } = require('./lib/tuya-lan-discovery');
const { TuyaLanClient } = require('./lib/tuya-lan-client');

module.exports = class VoldtApp extends Homey.App {
  async onInit() {
    this.onboarding = new Onboarding({ createAccount, discover,
      createLan: connection => ({ getStatus: () => {
        const read = () => new TuyaLanClient(connection).getStatus();
        const device = this.homey.drivers.getDriver('voldt').getDevices().find(item =>
          item.getStoreValue('localConnection')?.deviceId === connection.deviceId);
        return device ? device.enqueue(read) : read();
      } }),
      setTimer: this.homey.setTimeout.bind(this.homey), clearTimer: this.homey.clearTimeout.bind(this.homey) });
    this.log('Voldt started.');
  }

  async onUninit() { this.onboarding?.close(); }
};
