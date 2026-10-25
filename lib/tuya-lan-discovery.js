'use strict';

const dgram = require('node:dgram');
const os = require('node:os');
const net = require('node:net');
const { createHash, createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');

// Public discovery key, not the device-specific key needed for TCP control.
// Wire format corroborated against TinyTuya core/udp_helper.py + message_helper.py.
const DISCOVERY_KEY = createHash('md5').update('yGAdlopoPVldABfn').digest();

function query(localAddress, iv = randomBytes(12)) {
  const json = Buffer.from(JSON.stringify({ from: 'app', ip: localAddress }));
  const header = Buffer.alloc(18);
  header.writeUInt32BE(0x6699, 0);
  header.writeUInt32BE(0x25, 10);
  header.writeUInt32BE(12 + json.length + 16, 14);
  const cipher = createCipheriv('aes-128-gcm', DISCOVERY_KEY, iv);
  cipher.setAAD(header.subarray(4));
  return Buffer.concat([header, iv, cipher.update(json), cipher.final(), cipher.getAuthTag(), Buffer.from('00009966', 'hex')]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parseJson(bytes) {
  const candidates = [bytes, ...(bytes.length > 4 ? [bytes.subarray(4)] : [])];
  for (const candidate of candidates) {
    const text = candidate.toString('utf8').replace(/\0+$/, '').trim();
    if (!text.startsWith('{')) continue;
    try {
      const value = JSON.parse(text);
      if (value && typeof value === 'object' && value.from !== 'app' && (value.gwId || value.devId)) return value;
    } catch { /* Ignore incomplete/foreign datagrams. */ }
  }
  return null;
}

function decode(packet) {
  if (!Buffer.isBuffer(packet) || packet.length < 24) return null;
  const magic = packet.readUInt32BE(0);
  if (magic === 0x6699) {
    const size = packet.readUInt32BE(14);
    const end = 18 + size;
    if (size < 28 || packet.length !== end + 4 || packet.readUInt32BE(end) !== 0x9966) return null;
    try {
      const decipher = createDecipheriv('aes-128-gcm', DISCOVERY_KEY, packet.subarray(18, 30));
      decipher.setAAD(packet.subarray(4, 18));
      decipher.setAuthTag(packet.subarray(end - 16, end));
      return parseJson(Buffer.concat([decipher.update(packet.subarray(30, end - 16)), decipher.final()]));
    } catch { return null; }
  }
  if (magic !== 0x55aa) return null;
  const size = packet.readUInt32BE(12);
  const end = 16 + size;
  if (size < 8 || end !== packet.length || packet.readUInt32BE(end - 4) !== 0xaa55) return null;
  if (crc32(packet.subarray(0, end - 8)) !== packet.readUInt32BE(end - 8)) return null;
  for (const offset of [20, 16]) {
    const body = packet.subarray(offset, end - 8);
    const plain = parseJson(body);
    if (plain) return plain;
    if (!body.length || body.length % 16) continue;
    try {
      const decipher = createDecipheriv('aes-128-ecb', DISCOVERY_KEY, null);
      const value = parseJson(Buffer.concat([decipher.update(body), decipher.final()]));
      if (value) return value;
    } catch { /* Try the other return-code layout. */ }
  }
  return null;
}

function addresses() {
  return Object.values(os.networkInterfaces()).flat().filter(item => item.family === 'IPv4' && !item.internal)
    .map(item => ({ address: item.address, netmask: item.netmask }));
}

function broadcast(address, mask) {
  return address.split('.').map((part, index) => Number(part) | (255 ^ Number(mask.split('.')[index]))).join('.');
}

function announcementSummary(data) {
  // Field names expose omitted metadata without copying unknown credentials.
  const metadata = {};
  for (const name of ['ip', 'gwId', 'devId', 'version', 'productKey', 'productId', 'active', 'encrypt', 'ability', 'ablilty', 'wf_cfg', 'gb', 'origin']) {
    const value = data[name];
    if (['boolean', 'number', 'string'].includes(typeof value)) metadata[name] = value;
  }
  const fieldTypes = Object.fromEntries(Object.entries(data).map(([name, value]) => [name,
    typeof value === 'string' ? { type: 'string', bytes: Buffer.byteLength(value) }
      : { type: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value }]));
  return { fields: Object.keys(data).sort(), fieldTypes, metadata };
}

async function discover({ host, durationMs = 5000, includeAnnouncements = false } = {}) {
  if (host && net.isIP(host) !== 4) throw new Error('Vul een geldig lokaal IPv4-adres in.');
  const interfaces = addresses();
  const sockets = [];
  const found = new Map();
  const announcements = new Map();
  const diagnostics = [];
  function receive(packet, remote) {
    if (host && remote.address !== host) return;
    const data = decode(packet);
    if (!data) return;
    const entry = {
      host: remote.address, deviceId: String(data.gwId || data.devId),
      version: data.version ? String(data.version) : null,
      productKey: data.productKey || data.productId || null,
      source: 'udp-discovery', port: remote.port,
    };
    found.set(entry.deviceId, entry);
    if (includeAnnouncements) announcements.set(entry.deviceId, { host: remote.address, ...announcementSummary(data) });
  }
  try {
    for (const port of [6666, 6667, 7000]) {
      const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sockets.push(socket);
      socket.on('message', receive);
      socket.on('error', () => {});
      await new Promise(resolve => {
        socket.once('error', error => { diagnostics.push({ port, error: error.code }); resolve(); });
        socket.bind(port, '0.0.0.0', () => { socket.setBroadcast(true); resolve(); });
      });
    }
    // Solicit device information only. This command does not set device DPs.
    const sender = dgram.createSocket('udp4');
    sockets.push(sender);
    sender.on('message', receive);
    sender.on('error', () => {});
    await new Promise(resolve => { sender.once('error', resolve); sender.bind(0, '0.0.0.0', resolve); });
    sender.setBroadcast(true);
    for (const local of interfaces) {
      const message = query(local.address);
      const targets = host ? [host, broadcast(local.address, local.netmask)] : [broadcast(local.address, local.netmask)];
      for (const target of targets) sender.send(message, 7000, target, () => {});
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(15000, Math.max(1000, durationMs))));
    return { devices: [...found.values()], diagnostics, interfaces: interfaces.map(item => item.address),
      ...(includeAnnouncements ? { announcements: [...announcements.values()] } : {}) };
  } finally {
    for (const socket of sockets) { try { socket.close(); } catch { /* Already closed/unbound. */ } }
  }
}

module.exports = { discover, decode, query, DISCOVERY_KEY, crc32, announcementSummary };
