'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('sanitized source loads without private OEM configuration and fails explicitly only when account login is requested', () => {
  let createAccount;
  assert.doesNotThrow(() => { createAccount = require('../lib/voldt-account'); });
  assert.throws(() => createAccount('eu'), { code: 'OEM_CONFIG' });
});
