require('dotenv').config();
const express = require('express');
const morgan = require('morgan');
const routes = require('./routes');
const path = require('path');
const cron = require('node-cron');
const fs = require('fs/promises');
const fsSync = require('fs');

// Global error handlers to prevent crashes
process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process, just log the error
});

process.on('uncaughtException', (error) => {
  console.error('[CRITICAL] Uncaught Exception:', error);
  // Don't exit the process for WhatsApp client errors
  if (error.message && error.message.includes('Execution context was destroyed')) {
    console.log('[WARN] WhatsApp client navigation error, continuing...');
  } else {
    // For other critical errors, you might want to exit
    console.error('[CRITICAL] Fatal error, but keeping server alive');
  }
});

const app = express();

// CORS configuration
const cors = require('cors');
app.use(cors({ 
  origin: '*', // for dev only; lock origins in production
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Owner'],
  exposedHeaders: ['Content-Disposition', 'Content-Length'] // Required for downloads
}));

app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));
app.use(morgan('dev'));

app.use('/', routes);


const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const SESSION_EXPIRY_HOURS = Number(process.env.SESSION_EXPIRY_HOURS || 6);
const EXPIRY_MS = SESSION_EXPIRY_HOURS * 60 * 60 * 1000;

const EXPORT_RETENTION_HOURS = Number(process.env.EXPORT_RETENTION_HOURS || 48);
const DOWNLOADS_DIR = path.resolve(process.cwd(), 'src', 'downloads');

// Ensure downloads directory exists
if (!fsSync.existsSync(DOWNLOADS_DIR)) {
  fsSync.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// Simple periodic cleanup to remove expired client entries
const { listClients, stopClient, getClientEntry, reconnectPersistedClients } = require('./clientsRegistry');

// Reconnect to persisted clients on startup
(async () => {
  try {
    console.log('[INFO] Reconnecting to persisted clients...');
    await reconnectPersistedClients();
  } catch (error) {
    console.error('[ERROR] Failed to reconnect persisted clients:', error);
  }
})();

setInterval(async () => {
  try {
    const now = Date.now();
    const clients = listClients();
    for (const c of clients) {
      if (c.expiresAt && c.expiresAt < now) {
        console.log(`Cleaning expired client ${c.clientId}`);
        await stopClient(c.clientId);
      } else {
        // optional ping/update last seen
        const entry = getClientEntry(c.clientId);
        if (entry) entry.lastSeen = Date.now();
      }
    }
  } catch (e) {
    console.error('cleanup error', e);
  }
}, 60 * 1000); // every minute

// Automatic cleanup of expired export files (runs every hour)
cron.schedule('0 * * * *', async () => {
  console.log('[CLEANUP] Starting export files cleanup...');
  const now = Date.now();
  const maxAgeMs = EXPORT_RETENTION_HOURS * 60 * 60 * 1000;
  
  try {
    const files = await fs.readdir(DOWNLOADS_DIR);
    let deletedCount = 0;
    let totalSize = 0;
    
    for (const file of files) {
      // Only clean up .zip files (exports)
      if (!file.endsWith('.zip')) continue;
      
      const filePath = path.join(DOWNLOADS_DIR, file);
      
      try {
        const stats = await fs.stat(filePath);
        const fileAge = now - stats.mtime.getTime();
        
        if (fileAge > maxAgeMs) {
          const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
          await fs.unlink(filePath);
          deletedCount++;
          totalSize += stats.size;
          console.log(`[CLEANUP] Deleted expired export: ${file} (${fileSizeMB}MB, age: ${(fileAge / (1000 * 60 * 60)).toFixed(1)}h)`);
        }
      } catch (fileError) {
        console.error(`[CLEANUP ERROR] Failed to process file ${file}:`, fileError.message);
      }
    }
    
    if (deletedCount > 0) {
      console.log(`[CLEANUP] Completed: Deleted ${deletedCount} file(s), freed ${(totalSize / (1024 * 1024)).toFixed(2)}MB`);
    } else {
      console.log('[CLEANUP] No expired files to delete');
    }
  } catch (err) {
    console.error('[CLEANUP ERROR] Directory read error:', err);
  }
});

// Manual cleanup function (can be triggered via API if needed)
async function cleanupExpiredExports() {
  console.log('[MANUAL CLEANUP] Starting export files cleanup...');
  const now = Date.now();
  const maxAgeMs = EXPORT_RETENTION_HOURS * 60 * 60 * 1000;
  
  try {
    const files = await fs.readdir(DOWNLOADS_DIR);
    let deletedCount = 0;
    
    for (const file of files) {
      if (!file.endsWith('.zip')) continue;
      
      const filePath = path.join(DOWNLOADS_DIR, file);
      const stats = await fs.stat(filePath);
      const fileAge = now - stats.mtime.getTime();
      
      if (fileAge > maxAgeMs) {
        await fs.unlink(filePath);
        deletedCount++;
        console.log(`[MANUAL CLEANUP] Deleted: ${file}`);
      }
    }
    
    console.log(`[MANUAL CLEANUP] Completed: Deleted ${deletedCount} file(s)`);
    return { success: true, deletedCount };
  } catch (err) {
    console.error('[MANUAL CLEANUP ERROR]:', err);
    return { success: false, error: err.message };
  }
}

app.listen(PORT, HOST, () => {
  console.log(`Server listening at http://${HOST}:${PORT}`);
  console.log(`Server bound to all network interfaces (0.0.0.0) - accessible from network`);
  console.log(`Export retention: ${EXPORT_RETENTION_HOURS} hours`);
  console.log(`Session expiry: ${SESSION_EXPIRY_HOURS} hours`);
  console.log(`Downloads directory: ${DOWNLOADS_DIR}`);
});
