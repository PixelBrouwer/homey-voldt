'use strict';

const { TuyaCloud } = require('./lib/tuya-cloud');
const { validateMapping } = require('./lib/charger');
const { discover } = require('./lib/tuya-lan-discovery');
const { TuyaLanClient } = require('./lib/tuya-lan-client');
const { validateLocalMapping } = require('./lib/local-charger');
const { createTelemetryProfile } = require('./lib/charger-telemetry');
const friendlyError = require('./lib/friendly-error');

function devices(homey) {
  return homey.drivers.getDriver('voldt').getDevices();
}

function selectedDevice(homey, key) {
  const device = devices(homey).find(item => item.getData().id === key);
  if (!device) throw new Error('Selecteer een bestaand Voldt-apparaat in Homey.');
  return device;
}

function localConnection(body, device) {
  const input = body.connection || {};
  const stored = device.getStoreValue('localConnection');
  const localKey = input.localKey || (stored?.deviceId === input.deviceId ? stored.localKey : undefined);
  if (!localKey) throw new Error('De lokale apparaatsleutel ontbreekt. Netwerkontdekking levert deze sleutel niet.');
  return { host: input.host, deviceId: input.deviceId, version: input.version, localKey };
}

function connectionSummary(connection) {
  return connection ? { host: connection.host, deviceId: connection.deviceId, version: connection.version, hasKey: Boolean(connection.localKey) } : null;
}

module.exports = {
  async accountLogin({ homey, body }) {
    try { return await homey.app.onboarding.login(body); }
    catch (error) { throw friendlyError(homey, error); }
  },

  async accountFind({ homey, body }) {
    try {
      const device = body.deviceKey ? selectedDevice(homey, body.deviceKey) : undefined;
      return await homey.app.onboarding.find(body.token, { host: body.host,
        deviceId: device?.getStoreValue('localConnection')?.deviceId || device?.getStoreValue('deviceId') });
    } catch (error) { throw friendlyError(homey, error); }
  },

  async accountConfigure({ homey, body }) {
    try {
      const device = selectedDevice(homey, body.deviceKey);
      const current = device.getStoreValue('localConnection')?.deviceId || device.getStoreValue('deviceId');
      if (current && current !== body.id) throw Object.assign(new Error('INPUT'), { code: 'INPUT' });
      const prepared = homey.app.onboarding.getPrepared(body.token, body.id);
      await device.configureLocal(prepared);
      homey.app.onboarding.logout(body.token);
      return { configured: true };
    } catch (error) { throw friendlyError(homey, error); }
  },

  async accountLogout({ homey, body }) {
    homey.app.onboarding.logout(body.token);
    return true;
  },

  async discoverLocal({ homey, body }) {
    const result = await discover({ host: body.host, durationMs: body.durationMs, includeAnnouncements: body.includeAnnouncements === true });
    homey.settings.set('localDiscovery', result.devices);
    if (body.deviceKey && result.devices.length === 1) {
      const device = selectedDevice(homey, body.deviceKey);
      const found = result.devices[0];
      await device.setStoreValue('localTarget', { host: found.host, deviceId: found.deviceId, version: found.version });
      if (device.getStoreValue('pendingSetup') === true) {
        await device.setUnavailable(device.getStoreValue('localConnection')?.localKey
          ? 'Lokale sleutel opgeslagen; laadbediening nog bevestigen. Open App configureren.'
          : `Kabel lokaal gevonden op ${found.host} (protocol ${found.version}); lokale sleutel ontbreekt. Open App configureren.`);
      }
    }
    return result;
  },

  async inspectLocal({ homey, body }) {
    const device = selectedDevice(homey, body.deviceKey);
    const connection = localConnection(body, device);
    const status = await device.enqueue(() => new TuyaLanClient(connection).getStatus());
    const remembered = body.remember === true && device.getStoreValue('pendingSetup') === true;
    if (remembered) {
      await device.setStoreValue('localConnection', connection);
      await device.setStoreValue('localTarget', { host: connection.host, deviceId: connection.deviceId, version: connection.version });
      await device.setStoreValue('connectionType', 'local');
      await device.setUnavailable('Lokale sleutel opgeslagen; laadbediening nog bevestigen. Open App configureren.');
    }
    return { connected: true, ...connectionSummary(connection), dps: status.dps,
      ...(body.remember === true ? { remembered } : {}) };
  },

  async configureLocal({ homey, body }) {
    const device = selectedDevice(homey, body.deviceKey);
    if (body.verified !== true) throw new Error('Bevestig eerst welke DP laden start en stopt.');
    const connection = localConnection(body, device);
    const status = await device.enqueue(() => new TuyaLanClient(connection).getStatus());
    const mapping = validateLocalMapping(body.mapping, status.dps);
    const telemetryProfile = body.telemetrySchema ? createTelemetryProfile(body.telemetrySchema) : device.getStoreValue('localTelemetry');
    await device.configureLocal({ connection, mapping, telemetryProfile });
    return { configured: true, mode: 'local' };
  },
  async listDevices({ homey }) {
    return devices(homey).map(device => ({
      key: device.getData().id,
      name: device.getName(),
      configured: device.getStoreValue('pendingSetup') !== true && (device.getStoreValue('connectionType') === 'local'
        ? Boolean(device.getStoreValue('localConnection') && device.getStoreValue('localMapping'))
        : Boolean(device.getStoreValue('auth') && device.getStoreValue('mapping'))),
      local: connectionSummary(device.getStoreValue('localConnection') || device.getStoreValue('localTarget')),
    }));
  },

  async inspectCloud({ body }) {
    const snapshot = await new TuyaCloud(body.auth || {}).inspectDevice(body.deviceId);
    return {
      name: snapshot.info?.name || 'Voldt laadkabel',
      online: snapshot.info?.online === true,
      functions: snapshot.functions.filter(fn => ['boolean', 'bool', 'enum'].includes(String(fn.type).toLowerCase())),
      status: snapshot.status,
    };
  },

  async configureDevice({ homey, body }) {
    const device = devices(homey).find(item => item.getData().id === body.deviceKey);
    if (!device) throw new Error('Selecteer een bestaand Voldt-apparaat.');
    if (body.verified !== true) throw new Error('Bevestig eerst welke functie laden start en stopt.');
    const snapshot = await new TuyaCloud(body.auth || {}).inspectDevice(body.deviceId);
    const mapping = validateMapping(body.mapping, snapshot.functions);
    await device.configure({ auth: body.auth, deviceId: body.deviceId, mapping });
    return { configured: true };
  },
};
