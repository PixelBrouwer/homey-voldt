'use strict';

const { createCipheriv, createDecipheriv, createHmac, timingSafeEqual, randomBytes } = require('node:crypto');

const COMMANDS = Object.freeze({ SESSION_START: 3, SESSION_RESPONSE: 4, SESSION_FINISH: 5,
  CONTROL: 7, STATUS: 8, HEARTBEAT: 9, DP_QUERY: 10, CONTROL_NEW: 13, DP_QUERY_NEW: 16, DP_REFRESH: 18 });
const NO_VERSION_HEADER = new Set([3, 4, 5, 9, 10, 16, 18, 64]);
const MAX_FRAME_LENGTH = 256 * 1024;

function keyBytes(value) {
  const key = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value || ''), 'utf8');
  if (key.length !== 16) throw new Error('De lokale Tuya-sleutel moet precies 16 bytes zijn.');
  return key;
}

function versionString(value) {
  const version = String(value);
  if (!['3.3', '3.4', '3.5'].includes(version)) throw new Error('Ondersteunde LAN-protocolversies: 3.3, 3.4 en 3.5.');
  return version;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  return crc >>> 0;
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function ecb(data, key, decrypt = false, padding = true) {
  const cipher = decrypt ? createDecipheriv('aes-128-ecb', key, null) : createCipheriv('aes-128-ecb', key, null);
  cipher.setAutoPadding(padding);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

function readHeader(buffer) {
  if (buffer.length < 4) return null;
  const magic = buffer.readUInt32BE(0);
  const headerLength = magic === 0x6699 ? 18 : magic === 0x55aa ? 16 : 0;
  if (!headerLength) throw new Error('Onbekend Tuya LAN-pakketformaat.');
  if (buffer.length < headerLength) return null;
  const length = buffer.readUInt32BE(headerLength - 4);
  const totalLength = headerLength + length + (magic === 0x6699 ? 4 : 0);
  if (length < (magic === 0x6699 ? 28 : 8) || totalLength > MAX_FRAME_LENGTH) {
    throw new Error('Ongeldige Tuya LAN-pakketlengte.');
  }
  return { magic, headerLength, length, totalLength,
    sequence: buffer.readUInt32BE(magic === 0x6699 ? 6 : 4),
    command: buffer.readUInt32BE(magic === 0x6699 ? 10 : 8) };
}

function encodePacket({ version, key, sequence = 1, command, payload = Buffer.alloc(0), returnCode, iv }) {
  version = versionString(version);
  key = keyBytes(key);
  let plain = Buffer.isBuffer(payload) ? Buffer.from(payload) : Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload));
  if (plain.length > MAX_FRAME_LENGTH - 100) throw new Error('Tuya LAN-payload te groot.');
  const marker = Buffer.concat([Buffer.from(version), Buffer.alloc(12)]);
  const hasReturnCode = returnCode !== undefined && returnCode !== null;
  if (hasReturnCode && (!Number.isInteger(returnCode) || returnCode < 0 || returnCode > 0xffffffff)) throw new Error('Ongeldige Tuya-returncode.');
  const retcode = Buffer.alloc(hasReturnCode ? 4 : 0);
  if (hasReturnCode) retcode.writeUInt32BE(returnCode);

  if (version === '3.5') {
    if (!NO_VERSION_HEADER.has(command) && plain.length) plain = Buffer.concat([marker, plain]);
    plain = Buffer.concat([retcode, plain]);
    const nonce = iv === undefined ? randomBytes(12) : Buffer.from(iv);
    if (nonce.length !== 12) throw new Error('Tuya GCM-IV moet 12 bytes zijn.');
    const header = Buffer.alloc(18);
    header.writeUInt32BE(0x6699, 0);
    header.writeUInt16BE(0, 4);
    header.writeUInt32BE(sequence >>> 0, 6);
    header.writeUInt32BE(command >>> 0, 10);
    header.writeUInt32BE(12 + plain.length + 16, 14);
    const cipher = createCipheriv('aes-128-gcm', key, nonce);
    cipher.setAAD(header.subarray(4));
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([header, nonce, encrypted, cipher.getAuthTag(), Buffer.from('00009966', 'hex')]);
  }

  if (version === '3.4' && !NO_VERSION_HEADER.has(command) && plain.length) plain = Buffer.concat([marker, plain]);
  let encrypted = plain.length ? ecb(plain, key) : Buffer.alloc(0);
  if (version === '3.3' && !NO_VERSION_HEADER.has(command) && plain.length) encrypted = Buffer.concat([marker, encrypted]);
  const header = Buffer.alloc(16);
  const footerLength = version === '3.4' ? 36 : 8;
  header.writeUInt32BE(0x55aa, 0);
  header.writeUInt32BE(sequence >>> 0, 4);
  header.writeUInt32BE(command >>> 0, 8);
  header.writeUInt32BE(retcode.length + encrypted.length + footerLength, 12);
  const signed = Buffer.concat([header, retcode, encrypted]);
  const check = version === '3.4' ? createHmac('sha256', key).update(signed).digest() : Buffer.alloc(4);
  if (version === '3.3') check.writeUInt32BE(crc32(signed));
  return Buffer.concat([signed, check, Buffer.from('0000aa55', 'hex')]);
}

function decodePacket(frame, { version, key, expectReturnCode = true }) {
  version = versionString(version);
  key = keyBytes(key);
  const header = readHeader(frame);
  if (!header || frame.length !== header.totalLength) throw new Error('Onvolledig Tuya LAN-pakket.');
  if ((version === '3.5') !== (header.magic === 0x6699)) throw new Error('Tuya-pakket past niet bij gekozen protocolversie.');
  let payload;
  let returnCode = null;
  try {
    if (version === '3.5') {
      if (!frame.subarray(-4).equals(Buffer.from('00009966', 'hex'))) throw new Error('footer');
      const tagOffset = frame.length - 20;
      const decipher = createDecipheriv('aes-128-gcm', key, frame.subarray(18, 30));
      decipher.setAAD(frame.subarray(4, 18));
      decipher.setAuthTag(frame.subarray(tagOffset, tagOffset + 16));
      payload = Buffer.concat([decipher.update(frame.subarray(30, tagOffset)), decipher.final()]);
      if (expectReturnCode) {
        if (payload.length < 4) throw new Error('retcode');
        returnCode = payload.readUInt32BE(0);
        payload = payload.subarray(4);
      }
    } else {
      if (!frame.subarray(-4).equals(Buffer.from('0000aa55', 'hex'))) throw new Error('footer');
      const checkLength = version === '3.4' ? 32 : 4;
      const signed = frame.subarray(0, frame.length - checkLength - 4);
      const received = frame.subarray(frame.length - checkLength - 4, frame.length - 4);
      const expected = version === '3.4' ? createHmac('sha256', key).update(signed).digest() : Buffer.alloc(4);
      if (version === '3.3') expected.writeUInt32BE(crc32(signed));
      if (!timingSafeEqual(received, expected)) throw new Error('integrity');
      payload = signed.subarray(16);
      if (expectReturnCode) {
        if (payload.length < 4) throw new Error('retcode');
        returnCode = payload.readUInt32BE(0);
        payload = payload.subarray(4);
      }
      if (version === '3.3' && payload.subarray(0, 3).equals(Buffer.from(version))) {
        if (payload.length < 15) throw new Error('marker');
        payload = payload.subarray(15);
      }
      if (payload.length) payload = ecb(payload, key, true);
    }
    if (version !== '3.3' && payload.subarray(0, 3).equals(Buffer.from(version))) {
      if (payload.length < 15) throw new Error('marker');
      payload = payload.subarray(15);
    }
  } catch {
    throw new Error('Tuya LAN-authenticatie of pakketcontrole mislukt. Controleer lokale sleutel en protocolversie.');
  }
  return { sequence: header.sequence, command: header.command, returnCode, payload };
}

function deriveSessionKey(key, localNonce, remoteNonce, version) {
  key = keyBytes(key);
  version = versionString(version);
  if (localNonce.length !== 16 || remoteNonce.length !== 16) throw new Error('Ongeldige Tuya-sessienonces.');
  const mixed = Buffer.from(localNonce.map((byte, index) => byte ^ remoteNonce[index]));
  if (version === '3.4') return ecb(mixed, key, false, false);
  if (version !== '3.5') throw new Error('Deze protocolversie heeft geen sessieonderhandeling.');
  const cipher = createCipheriv('aes-128-gcm', key, localNonce.subarray(0, 12));
  return Buffer.concat([cipher.update(mixed), cipher.final()]);
}

module.exports = { COMMANDS, MAX_FRAME_LENGTH, crc32, keyBytes, versionString, readHeader, encodePacket, decodePacket, deriveSessionKey };
