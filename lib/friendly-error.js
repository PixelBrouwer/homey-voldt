'use strict';
const en = require('../locales/en.json');
module.exports = function friendlyError(homey, error) {
  const code = Object.hasOwn(en.errors, error?.code) ? error.code : 'ONBOARDING_FAILED';
  return Object.assign(new Error(homey.__ ? homey.__(`errors.${code}`) : en.errors[code]), { code });
};
