'use strict';
const { OemMobileClient } = require('./oem-mobile-client');
const { OemMobileCrypto } = require('./oem-mobile-crypto');

module.exports = function createAccount(region) {
  let identity;
  try {
    identity = require('./voldt-app-identity.json');
    if (['packageName', 'clientId', 'certificateSha256', 'containerSecret', 'appSecret'].some(key =>
      typeof identity[key] !== 'string' || !identity[key].trim())) throw Error('Incomplete configuration');
  } catch {
    throw Object.assign(new Error('Private OEM configuration is required for account login. See SECURITY.md.'), { code: 'OEM_CONFIG' });
  }
  return new OemMobileClient({ clientId: identity.clientId, crypto: new OemMobileCrypto(identity), region, timeoutMs: 8000 });
};
