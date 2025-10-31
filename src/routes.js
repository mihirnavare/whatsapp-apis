const express = require('express');
const router = express.Router();
const { createClientEntry, getClientEntry, stopClient, deleteClient, listClients, sendMessage, getChatsAccordingToTime, fetchMessagesForChat } = require('./clientsRegistry');
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

// Serve downloads/media (legacy endpoint - kept for backward compatibility)
router.get('/media/:filename', (req, res) => {
  const filePath = path.join(DOWNLOADS_DIR, req.params.filename);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  } else {
    return res.status(404).send('Not found');
  }
});

// Secure download endpoint with network accessibility
router.get('/downloads/:filename', (req, res) => {
  try {
    const filename = req.params.filename;
    const clientIP = req.ip || req.connection.remoteAddress;
    
    console.log(`[DOWNLOAD] IP: ${clientIP}, File: ${filename}, Time: ${new Date().toISOString()}`);
    
    // Security: Prevent directory traversal attacks
    const sanitizedFilename = path.basename(filename);
    
    // Security: Only allow .zip files
    if (!sanitizedFilename.endsWith('.zip')) {
      console.log(`[DOWNLOAD ERROR] Invalid file type requested: ${sanitizedFilename}`);
      return res.status(400).json({
        success: false,
        error: 'Invalid file type. Only ZIP files are allowed.'
      });
    }
    
    // Construct file path
    const filePath = path.join(DOWNLOADS_DIR, sanitizedFilename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.log(`[DOWNLOAD ERROR] File not found: ${sanitizedFilename}`);
      return res.status(404).json({
        success: false,
        error: 'File not found. It may have expired (files are kept for 48 hours).'
      });
    }
    
    // Optional: Check file size limit (500MB)
    const stats = fs.statSync(filePath);
    const MAX_DOWNLOAD_SIZE = 500 * 1024 * 1024; // 500MB
    
    if (stats.size > MAX_DOWNLOAD_SIZE) {
      console.log(`[DOWNLOAD ERROR] File too large: ${sanitizedFilename} (${stats.size} bytes)`);
      return res.status(413).json({
        success: false,
        error: 'File too large. Maximum download size is 500MB.'
      });
    }
    
    // Set proper headers for download
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizedFilename}"`);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Access-Control-Allow-Origin', '*'); // CORS for cross-origin downloads
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    
    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    
    fileStream.on('error', (err) => {
      console.error(`[DOWNLOAD ERROR] Stream error for ${sanitizedFilename}:`, err);
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Download failed. Please try again.'
        });
      }
    });
    
    fileStream.on('end', () => {
      console.log(`[DOWNLOAD SUCCESS] File: ${sanitizedFilename}, Size: ${(stats.size / (1024 * 1024)).toFixed(2)}MB, Client: ${clientIP}`);
    });
    
    // Pipe the file to response
    fileStream.pipe(res);
    
  } catch (err) {
    console.error('[DOWNLOAD ERROR] Unexpected error:', err);
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// GET /clients/:id/chats
// Query params: time (hours or "all")
router.get('/clients/:id/chats', async (req, res) => {
  const { id } = req.params;
  const time = req.query.time || 'all';
  
  try {
    const entry = getClientEntry(id);
    if (!entry) return res.status(404).json({ error: 'client not found' });
    if (entry.status !== 'ready') {
      return res.status(400).json({ error: 'client not ready', status: entry.status });
    }
    
    const chats = await getChatsAccordingToTime(id, time);
    
    return res.json({
      clientId: id,
      timeFilter: time,
      totalChats: chats.length,
      chats
    });
  } catch (e) {
    console.error('[ERROR] Get chats error:', e);
    return res.status(500).json({ error: e.message });
  }
});

// POST /clients/:id/export-chats
// Body: { chatIds: ["123@c.us", "456@c.us"] }
router.post('/clients/:id/export-chats', async (req, res) => {
  const { id } = req.params;
  const { chatIds } = req.body;
  
  if (!chatIds || !Array.isArray(chatIds) || chatIds.length === 0) {
    return res.status(400).json({ error: 'chatIds array required' });
  }
  
  try {
    const entry = getClientEntry(id);
    if (!entry) return res.status(404).json({ error: 'client not found' });
    if (entry.status !== 'ready') {
      return res.status(400).json({ error: 'client not ready', status: entry.status });
    }
    
    console.log(`[DEBUG] Starting export for ${chatIds.length} chats`);
    const result = await fetchMessagesForChat(id, chatIds);
    
    return res.json({
      success: true,
      exportedChats: result.exportedChats,
      downloadUrl: result.downloadUrl,
      zipFilename: result.zipFilename
    });
  } catch (e) {
    console.error('[ERROR] Export chats error:', e);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;
