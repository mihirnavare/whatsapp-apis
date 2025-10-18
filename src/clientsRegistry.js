// Simple in-memory client registry. Swap with DB (Mongo/Redis) for production.
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.resolve(process.cwd(), 'data'); // volume mounted to persist LocalAuth
const DOWNLOADS_DIR = path.resolve(process.cwd(), 'src', 'downloads');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

/*
  clients map:
  clientId -> {
    client, status, owner, createdAt, expiresAt, qrDataUrl, lastSeen
  }
*/
const clients = new Map();

function createClientEntry(owner, expiryMs) {
  const clientId = uuidv4();
  const dataPathClient = path.join(DATA_DIR, clientId);

  const client = new Client({
    authStrategy: new LocalAuth({ clientId }), // LocalAuth will store session under .wwebjs_local_auth/<clientId>
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process'
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'
    },
    takeoverOnConflict: true
  });

  const entry = {
    client,
    clientId,
    owner,
    status: 'initializing',
    createdAt: Date.now(),
    expiresAt: Date.now() + expiryMs,
    qrDataUrl: null,
    lastSeen: Date.now()
  };

  // Event handlers
  client.on('qr', async (qr) => {
    try {
      const dataUrl = await qrcode.toDataURL(qr);
      entry.qrDataUrl = dataUrl;
      entry.status = 'qr';
      entry.lastSeen = Date.now();
    } catch (e) {
      console.error('QR to data url error', e);
    }
  });

  client.on('ready', () => {
    entry.status = 'ready';
    entry.qrDataUrl = null;
    entry.lastSeen = Date.now();
    console.log(`Client ${clientId} ready`);
  });

  client.on('authenticated', () => {
    entry.status = 'authenticated';
    entry.lastSeen = Date.now();
  });

  client.on('auth_failure', (msg) => {
    console.warn(`Auth failure for client ${clientId}:`, msg);
    entry.status = 'auth_failure';
    entry.lastSeen = Date.now();
  });

  client.on('disconnected', (reason) => {
    console.log(`Client ${clientId} disconnected:`, reason);
    entry.status = 'disconnected';
    entry.lastSeen = Date.now();
  });

  client.initialize();
  clients.set(clientId, entry);
  return entry;
}

function getClientEntry(clientId) {
  return clients.get(clientId);
}

async function stopClient(clientId) {
  const entry = clients.get(clientId);
  if (!entry) return false;
  try {
    await entry.client.destroy();
  } catch (e) {
    console.error('Error destroying client', e);
  }
  clients.delete(clientId);

  // Attempt to remove LocalAuth folder
  const authPath = path.join(DATA_DIR, clientId);
  // Note: LocalAuth stores under default .wwebjs_local_auth in library; but we volume mount /.wwebjs_auth at container root.
  try {
    if (fs.existsSync(authPath)) {
      fs.rmSync(authPath, { recursive: true, force: true });
    }
  } catch (e) {
    console.error('failed to clean auth folder', e);
  }

  return true;
}

function listClients() {
  return Array.from(clients.values()).map(e => ({
    clientId: e.clientId,
    owner: e.owner,
    status: e.status,
    createdAt: e.createdAt,
    expiresAt: e.expiresAt,
    lastSeen: e.lastSeen
  }));
}

/**
 * Send message. media optional = { filename, mime, base64 }
 */
async function sendMessage(clientId, phone, message, media) {
  const entry = clients.get(clientId);
  if (!entry) throw new Error('client not found');
  if (!entry.client) throw new Error('client not initialized');

  const client = entry.client;
  const jid = phone.includes('@') ? phone : `${phone}@c.us`;

  if (media && media.base64 && media.mime) {
    const mediaObj = new MessageMedia(media.mime, media.base64, media.filename || `file_${Date.now()}`);
    return client.sendMessage(jid, mediaObj, { caption: message || '' });
  } else {
    return client.sendMessage(jid, message || '');
  }
}

/**
 * Delete a client session (alias for stopClient for API consistency)
 */
async function deleteClient(clientId) {
  return await stopClient(clientId);
}

module.exports = {
  createClientEntry,
  getClientEntry,
  stopClient,
  deleteClient,
  listClients,
  sendMessage
};
