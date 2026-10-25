'use strict';
const Homey = require('homey');
const friendlyError = require('../../lib/friendly-error');

module.exports = class VoldtDriver extends Homey.Driver {
  async onPair(session) { return this.configureSession(session); }
  async onRepair(session, device) { return this.configureSession(session, device); }

  takeSetupTicket(ticket, deviceId) { return this.homey.app.onboarding.takeTicket(ticket, deviceId); }

  async configureSession(session, device) {
    const onboarding = this.homey.app.onboarding;
    let token;
    let list;
    let closed = false;
    let busy = false;
    session.setHandler('get_mode', async () => ({ repair: Boolean(device) }));
    session.setHandler('disconnect', async () => { closed = true; onboarding.logout(token); });
    session.setHandler('account_login', async input => {
      if (busy) throw friendlyError(this.homey, { code: 'BUSY' });
      busy = true;
      onboarding.logout(token);
      token = undefined;
      list = undefined;
      try {
        const login = await onboarding.login(input);
        token = login.token;
        if (closed) { onboarding.logout(token); throw Object.assign(new Error('SESSION_EXPIRED'), { code: 'SESSION_EXPIRED' }); }
        const currentId = device?.getStoreValue('localConnection')?.deviceId || device?.getStoreValue('deviceId');
        const found = await onboarding.find(token, { host: input.host, deviceId: currentId });
        if (!found.devices.length) return { found: 0 };
        if (device) {
          if (found.devices.length !== 1) throw Object.assign(new Error('NO_CABLE'), { code: 'NO_CABLE' });
          await device.configureLocal(onboarding.getPrepared(token, found.devices[0].id));
          onboarding.logout(token);
          return { repaired: true };
        }
        const existing = new Set(this.getDevices().map(item => item.getStoreValue('localConnection')?.deviceId || item.getStoreValue('deviceId') || item.getData().id));
        list = found.devices.filter(item => !existing.has(item.id)).map(item => ({
          name: item.name,
          data: { id: item.id },
          store: { pendingSetup: true, deviceId: item.id, setupTicket: onboarding.createTicket(token, item.id) },
          settings: { poll_interval: 15 },
        }));
        return { found: list.length, alreadyAdded: found.devices.length > 0 && !list.length };
      } catch (error) { throw friendlyError(this.homey, error); }
      finally { busy = false; }
    });
    session.setHandler('list_devices', async () => {
      if (!list) throw friendlyError(this.homey, { code: 'SESSION_EXPIRED' });
      return list;
    });
  }
};
