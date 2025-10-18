const express = require('express');
const router = express.Router();
const { createClientEntry, getClientEntry, stopClient, deleteClient, listClients, sendMessage } = require('./clientsRegistry');
const { saveBase64ToFile, DOWNLOADS_DIR } = require('./utils');
const path = require('path');
const fs = require('fs');

const SESSION_EXPIRY_HOURS = Number(process.env.SESSION_EXPIRY_HOURS || 6);
const EXPIRY_MS = SESSION_EXPIRY_HOURS * 60 * 60 * 1000;

// POST /clients/start
router.post('/clients/start', async (req, res) => {
  try {
    const owner = req.body.owner || req.headers['x-owner'] || 'anonymous';
    const entry = createClientEntry(owner, EXPIRY_MS);
    return res.json({
      clientId: entry.clientId,
      status: entry.status,
      expiresAt: entry.expiresAt
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});

// GET /clients/:id/status
router.get('/clients/:id/status', (req, res) => {
  const { id } = req.params;
  const entry = getClientEntry(id);
  if (!entry) return res.status(404).json({ error: 'client not found' });
  return res.json({
    clientId: entry.clientId,
    owner: entry.owner,
    status: entry.status,
    qr: entry.qrDataUrl,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
    lastSeen: entry.lastSeen
  });
});

// POST /clients/:id/send
// Body: { phone, message, media: { filename, mime, base64 } }
router.post('/clients/:id/send', async (req, res) => {
  const { id } = req.params;
  const { phone, message } = req.body;
  let media = req.body.media;

  if (!phone) return res.status(400).json({ error: 'phone required' });

  try {
    // If client passed a data url or base64 but not as object
    if (media && typeof media === 'string' && media.startsWith('data:')) {
      // data:<mime>;base64,<data>
      const parts = media.split(',');
      const meta = parts[0];
      const base64 = parts[1];
      const mime = meta.match(/data:(.*);base64/)[1];
      const filename = `upload_${Date.now()}`;
      media = { filename, mime, base64 };
    }

    // If media is given as base64 and filename is present, we save it for reference
    if (media && typeof media.base64 === 'string') {
      // optional: save file locally
      const safeName = media.filename || `file_${Date.now()}`;
      saveBase64ToFile(media.base64, safeName);
    }

    const resp = await sendMessage(id, phone, message, media);
    return res.json({ success: true, responseId: resp.id || null });
  } catch (e) {
    console.error('send error', e);
    return res.status(500).json({ error: e.message });
  }
});

// POST /clients/:id/stop
router.post('/clients/:id/stop', async (req, res) => {
  const { id } = req.params;
  try {
    const ok = await stopClient(id);
    if (!ok) return res.status(404).json({ error: 'client not found' });
    return res.json({ stopped: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
});

// DELETE /clients/:id
router.delete('/clients/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const ok = await deleteClient(id);
    if (!ok) return res.status(404).json({ error: 'client not found' });
    return res.json({ deleted: true, clientId: id });
  } catch (e) {
    console.error('Delete client error:', e);
    return res.status(500).json({ error: e.message });
  }
});

// GET /clients (list)
router.get('/clients', (req, res) => {
  return res.json(listClients());
});

// Serve downloads/media
router.get('/media/:filename', (req, res) => {
  const filePath = path.join(DOWNLOADS_DIR, req.params.filename);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  } else {
    return res.status(404).send('Not found');
  }
});

module.exports = router;
