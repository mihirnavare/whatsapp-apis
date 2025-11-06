// Simple in-memory client registry. Swap with DB (Mongo/Redis) for production.
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const { getExtensionFromMime, createZipArchive } = require('./utils');

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

  console.log(`[DEBUG] Creating client with clientId: ${clientId}`);
  console.log(`[DEBUG] Using LocalAuth at: ${dataPathClient}`);
  console.log(`[DEBUG] Puppeteer executablePath: ${process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium'}`);
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
        '--disable-gpu'
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium',
      timeout: 60000
    },
    takeoverOnConflict: true,
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
    }
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
  client.on('loading_screen', (percent, message) => {
    console.log(`[DEBUG] Client ${clientId} loading screen: ${percent}% - ${message}`);
  });

  client.on('change_state', (state) => {
    console.log(`[DEBUG] Client ${clientId} state changed to: ${state}`);
  });

  client.on('qr', async (qr) => {
    console.log(`[DEBUG] QR event emitted for client ${clientId}`);
    try {
      const dataUrl = await qrcode.toDataURL(qr);
      entry.qrDataUrl = dataUrl;
      entry.status = 'qr';
      entry.lastSeen = Date.now();
      console.log(`[DEBUG] QR code generated and stored for client ${clientId}`);
    } catch (e) {
      console.error('[ERROR] QR to data url error', e);
    }
  });

  client.on('ready', () => {
    entry.status = 'ready';
    entry.qrDataUrl = null;
    entry.lastSeen = Date.now();
    console.log(`[DEBUG] Client ${clientId} ready`);
  });

  client.on('authenticated', () => {
    entry.status = 'authenticated';
    entry.lastSeen = Date.now();
    console.log(`[DEBUG] Client ${clientId} authenticated`);
  });

  client.on('auth_failure', (msg) => {
    console.warn(`[WARN] Auth failure for client ${clientId}:`, msg);
    entry.status = 'auth_failure';
    entry.lastSeen = Date.now();
  });

  client.on('disconnected', (reason) => {
    console.log(`[DEBUG] Client ${clientId} disconnected:`, reason);
    entry.status = 'disconnected';
    entry.lastSeen = Date.now();
  });

  // Capture any unhandled errors from the client
  client.on('error', (error) => {
    console.error(`[ERROR] Client ${clientId} error:`, error);
  });

  // Listen for remote_session_saved event
  client.on('remote_session_saved', () => {
    console.log(`[DEBUG] Client ${clientId} remote session saved`);
  });

  try {
    client.initialize();
    console.log(`[DEBUG] client.initialize() called for clientId: ${clientId}`);
    
    // Add timeout to detect stuck initialization
    setTimeout(() => {
      if (entry.status === 'initializing') {
        console.error(`[ERROR] Client ${clientId} stuck in initializing state for 30 seconds`);
      }
    }, 30000);
  } catch (e) {
    console.error(`[ERROR] Failed to initialize client ${clientId}:`, e);
  }
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

  // ✅ Use default country code if number does not start with a country code
  const defaultCountryCode = process.env.DEFAULT_COUNTRY_CODE || '91';
  let normalizedPhone = phone.toString().trim();

  // Check if number starts with country code (assume if it starts with '+' or already 11+ digits)
  if (!normalizedPhone.startsWith('+') && normalizedPhone.length <= 10) {
    normalizedPhone = defaultCountryCode + normalizedPhone;
  }

  const jid = normalizedPhone.includes('@') ? normalizedPhone : `${normalizedPhone}@c.us`;

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

/**
 * Get chats according to time filter
 * @param {string} clientId - Client ID
 * @param {number|string} time - Hours (e.g., 1, 24, 48) or "all" for no filter
 * @returns {Promise<Array>} - Array of chat IDs
 */
async function getChatsAccordingToTime(clientId, time) {
  const entry = clients.get(clientId);
  if (!entry) throw new Error('client not found');
  if (entry.status !== 'ready') throw new Error('client not ready');

  const client = entry.client;
  
  try {
    console.log(`[DEBUG] Attempting to fetch chats for client ${clientId}`);
    
    // Alternative approach: Use pupPage to get chat data directly
    let chats = [];
    
    try {
      console.log(`[DEBUG] Trying alternative method using Store...`);
      
      // Access the internal store which is more reliable
      const pupPage = client.pupPage;
      
      // Execute JavaScript in the WhatsApp Web context to get chats
      const chatData = await pupPage.evaluate(() => {
        // Access WhatsApp's internal store
        const Store = window.Store || window.require('WAWebCollections');
        if (!Store || !Store.Chat) {
          return { success: false, error: 'Store not available' };
        }
        
        try {
          const allChats = Store.Chat.getModelsArray();
          
          return {
            success: true,
            chats: allChats.map(chat => {
              // Multiple ways to detect group chats for better accuracy
              const isGroup = chat.isGroup || 
                             chat.kind === 'group' || 
                             (chat.id && chat.id._serialized && chat.id._serialized.includes('@g.us')) ||
                             (chat.id && chat.id.server === 'g.us') ||
                             false;
              
              return {
                id: chat.id._serialized || chat.id.user + '@c.us',
                name: chat.name || chat.formattedTitle || chat.contact?.name || 'Unknown',
                isGroup: isGroup,
                lastMessageTimestamp: chat.lastReceivedKey ? chat.lastReceivedKey.fromMe ? 
                  chat.t : chat.lastReceivedKey.t || chat.t : chat.t || 0
              };
            })
          };
        } catch (e) {
          return { success: false, error: e.message };
        }
      });
      
      if (!chatData.success) {
        console.error(`[ERROR] Store evaluation failed:`, chatData.error);
        throw new Error(`Failed to access WhatsApp Store: ${chatData.error}`);
      }
      
      console.log(`[DEBUG] Successfully fetched ${chatData.chats.length} chats using Store`);
      
      // Convert to our format
      chats = chatData.chats.map(c => ({
        id: { _serialized: c.id },
        name: c.name,
        isGroup: c.isGroup,
        lastMessage: c.lastMessageTimestamp ? { timestamp: c.lastMessageTimestamp } : null
      }));
      
    } catch (storeError) {
      console.error(`[ERROR] Store method failed:`, storeError.message);
      console.log(`[DEBUG] Falling back to getChats() method...`);
      
      // Fallback to original getChats method
      let attempts = 0;
      const maxAttempts = 3;
      
      while (attempts < maxAttempts) {
        try {
          console.log(`[DEBUG] Attempt ${attempts + 1} to get chats`);
          chats = await client.getChats();
          console.log(`[DEBUG] Successfully fetched ${chats.length} total chats`);
          break;
        } catch (error) {
          attempts++;
          console.error(`[ERROR] Attempt ${attempts} failed:`, error.message);
          
          if (attempts >= maxAttempts) {
            throw new Error(`Both Store and getChats methods failed. WhatsApp Web interface may have changed. Try: 1) Restarting the session, 2) Updating whatsapp-web.js library, 3) Using a different WhatsApp Web version`);
          }
          
          // Wait before retry
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
    }
    
    if (!chats || !Array.isArray(chats)) {
      throw new Error('Invalid chats data received');
    }
    
    const now = Date.now();
    let filteredChats;
    
    if (time === 'all') {
      // Filter out group chats - check both isGroup flag and ID format
      filteredChats = chats.filter(chat => {
        try {
          if (!chat) return false;
          
          // Check isGroup flag
          if (chat.isGroup) return false;
          
          // Additional check: group chat IDs end with @g.us
          const chatId = chat.id?._serialized || '';
          if (chatId.includes('@g.us')) return false;
          
          return true;
        } catch (e) {
          console.error(`[ERROR] Error filtering chat:`, e);
          return false;
        }
      });
      console.log(`[DEBUG] Time filter: all, ${filteredChats.length} non-group chats`);
    } else {
      // Convert hours to milliseconds
      const timeWindow = now - (Number(time) * 60 * 60 * 1000);
      
      filteredChats = chats.filter(chat => {
        try {
          if (!chat) return false;
          
          // Filter out group chats - check both isGroup flag and ID format
          if (chat.isGroup) return false;
          
          // Additional check: group chat IDs end with @g.us
          const chatId = chat.id?._serialized || '';
          if (chatId.includes('@g.us')) return false;
          
          if (!chat.lastMessage) return false;
          
          // WhatsApp timestamp is in seconds, convert to milliseconds
          const lastMsgTimestamp = chat.lastMessage.timestamp * 1000;
          return lastMsgTimestamp >= timeWindow;
        } catch (e) {
          console.error(`[ERROR] Error filtering chat by time:`, e);
          return false;
        }
      });
      
      console.log(`[DEBUG] Time filter: ${time} hours, ${filteredChats.length} chats match`);
    }
    
    return filteredChats.map(chat => {
      try {
        return {
          chatId: chat.id._serialized || chat.id.user + '@c.us',
          name: chat.name || 'Unknown',
          lastMessageTime: chat.lastMessage ? chat.lastMessage.timestamp : null
        };
      } catch (e) {
        console.error(`[ERROR] Error mapping chat:`, e);
        return {
          chatId: 'error-chat',
          name: 'Error Chat',
          lastMessageTime: null
        };
      }
    }).filter(chat => chat.chatId !== 'error-chat');
    
  } catch (error) {
    console.error(`[ERROR] Failed to get chats for client ${clientId}:`, error);
    throw error;
  }
}

/**
 * Get chats that have RECEIVED attachments (not just messages) in the given time range
 * @param {string} clientId - Client ID
 * @param {number|string} time - Hours (e.g., 1, 24, 48) or "all" for no filter
 * @returns {Promise<Array>} - Array of chat IDs with received attachments
 */
async function getChatsWithReceivedAttachments(clientId, time) {
  const entry = clients.get(clientId);
  if (!entry) throw new Error('client not found');
  if (entry.status !== 'ready') throw new Error('client not ready');

  const client = entry.client;
  
  try {
    console.log(`[DEBUG] Fetching chats with received attachments for client ${clientId}`);
    
    // First, get all chats
    let chats = [];
    
    try {
      const pupPage = client.pupPage;
      
      const chatData = await pupPage.evaluate(() => {
        const Store = window.Store || window.require('WAWebCollections');
        if (!Store || !Store.Chat) {
          return { success: false, error: 'Store not available' };
        }
        
        try {
          const allChats = Store.Chat.getModelsArray();
          
          return {
            success: true,
            chats: allChats.map(chat => {
              const isGroup = chat.isGroup || 
                             chat.kind === 'group' || 
                             (chat.id && chat.id._serialized && chat.id._serialized.includes('@g.us')) ||
                             (chat.id && chat.id.server === 'g.us') ||
                             false;
              
              return {
                id: chat.id._serialized || chat.id.user + '@c.us',
                name: chat.name || chat.formattedTitle || chat.contact?.name || 'Unknown',
                isGroup: isGroup,
                lastMessageTimestamp: chat.lastReceivedKey ? chat.lastReceivedKey.fromMe ? 
                  chat.t : chat.lastReceivedKey.t || chat.t : chat.t || 0
              };
            })
          };
        } catch (e) {
          return { success: false, error: e.message };
        }
      });
      
      if (!chatData.success) {
        throw new Error(`Failed to access WhatsApp Store: ${chatData.error}`);
      }
      
      chats = chatData.chats.map(c => ({
        id: { _serialized: c.id },
        name: c.name,
        isGroup: c.isGroup,
        lastMessage: c.lastMessageTimestamp ? { timestamp: c.lastMessageTimestamp } : null
      }));
      
    } catch (storeError) {
      console.log(`[DEBUG] Falling back to getChats() method...`);
      chats = await client.getChats();
    }
    
    // Filter out group chats
    const nonGroupChats = chats.filter(chat => {
      if (!chat) return false;
      if (chat.isGroup) return false;
      const chatId = chat.id?._serialized || '';
      return !chatId.includes('@g.us');
    });
    
    console.log(`[DEBUG] Found ${nonGroupChats.length} non-group chats, checking for received attachments...`);
    
    // Calculate time window
    const now = Date.now();
    const timeWindow = time === 'all' ? 0 : now - (Number(time) * 60 * 60 * 1000);
    
    // Check each chat for received attachments
    const chatsWithAttachments = [];
    
    for (const chat of nonGroupChats) {
      try {
        const chatId = chat.id._serialized;
        const fullChat = await client.getChatById(chatId);
        
        // Fetch recent messages (limit to reasonable number for performance)
        const messages = await fullChat.fetchMessages({ limit: 100 });
        
        // Check if any received message has media in the time range
        const hasReceivedAttachment = messages.some(msg => {
          // Must be received (not sent by us)
          if (msg.fromMe) return false;
          
          // Must have media
          if (!msg.hasMedia) return false;
          
          // Check time window
          const msgTimestamp = msg.timestamp * 1000; // Convert to milliseconds
          if (time !== 'all' && msgTimestamp < timeWindow) return false;
          
          return true;
        });
        
        if (hasReceivedAttachment) {
          // Get count of received attachments
          const attachmentCount = messages.filter(msg => !msg.fromMe && msg.hasMedia).length;
          
          chatsWithAttachments.push({
            chatId: chatId,
            name: chat.name || 'Unknown',
            receivedAttachmentsCount: attachmentCount
          });
          
          console.log(`[DEBUG] Chat ${chatId} has ${attachmentCount} received attachments`);
        }
        
      } catch (chatError) {
        console.error(`[ERROR] Failed to check chat ${chat.id._serialized}:`, chatError.message);
        // Continue with next chat
      }
    }
    
    console.log(`[DEBUG] Found ${chatsWithAttachments.length} chats with received attachments`);
    
    return chatsWithAttachments;
    
  } catch (error) {
    console.error(`[ERROR] Failed to get chats with received attachments:`, error);
    throw error;
  }
}

/**
 * Fetch messages for multiple chats and export as ZIP
 * @param {string} clientId - Client ID
 * @param {Array<string>} chatIds - Array of chat IDs to export
 * @returns {Promise<string>} - Path to the created ZIP file
 */
async function fetchMessagesForChat(clientId, chatIds) {
  const entry = clients.get(clientId);
  if (!entry) throw new Error('client not found');
  if (entry.status !== 'ready') throw new Error('client not ready');

  const client = entry.client;
  const exportId = `export_${Date.now()}`;
  const exportFolder = path.join(DOWNLOADS_DIR, exportId);
  
  // Create main export folder
  fs.mkdirSync(exportFolder, { recursive: true });
  
  console.log(`[DEBUG] Starting export for ${chatIds.length} chats to ${exportFolder}`);

  for (const chatId of chatIds) {
    try {
      console.log(`[DEBUG] Processing chat: ${chatId}`);
      
      // Create folder for this chat
      const chatFolder = path.join(exportFolder, chatId.replace(/[^a-zA-Z0-9]/g, '_'));
      fs.mkdirSync(chatFolder, { recursive: true });

      // Fetch the chat
      const chat = await client.getChatById(chatId);
      
      // Fetch messages (adjust limit as needed)
      const messages = await chat.fetchMessages({ limit: 10000 });
      console.log(`[DEBUG] Fetched ${messages.length} messages for chat ${chatId}`);

      const chatMessages = [];
      let mediaCount = 0;

      for (const msg of messages) {
        // Collect message data
        const messageData = {
          id: msg.id.id,
          timestamp: msg.timestamp,
          body: msg.body,
          from: msg.from,
          to: msg.to,
          fromMe: msg.fromMe,
          type: msg.type,
          hasMedia: msg.hasMedia
        };

        chatMessages.push(messageData);

        // Download media if present
        if (msg.hasMedia) {
          // Check if this is a downloadable media type
          let shouldSkip = false;
          let skipReason = '';
          
          try {
            // Skip unsupported message types (interactive, buttons, polls, etc.)
            const unsupportedTypes = ['interactive', 'buttons', 'list', 'poll', 'ciphertext', 'list_response', 'buttons_response'];
            if (unsupportedTypes.includes(msg.type)) {
              shouldSkip = true;
              skipReason = `Unsupported media type: ${msg.type}`;
            }
            
            // Additional check: inspect message object for interactive properties
            if (!shouldSkip && msg._data) {
              if (msg._data.isInteractive || msg._data.interactiveType) {
                shouldSkip = true;
                skipReason = 'Interactive message type detected in _data';
              }
              
              // Check for buttons/list in raw data
              if (msg._data.type === 'interactive' || msg._data.type === 'buttons' || msg._data.type === 'list') {
                shouldSkip = true;
                skipReason = `Interactive type in _data: ${msg._data.type}`;
              }
            }
            
            if (shouldSkip) {
              console.log(`[DEBUG] Skipping message ${msg.id.id}: ${skipReason}`);
              messageData.mediaSkipped = skipReason;
              continue;
            }
            
            console.log(`[DEBUG] Downloading media (type: ${msg.type}) for message ${msg.id.id}`);
            const media = await msg.downloadMedia();
            
            if (media) {
              const extension = getExtensionFromMime(media.mimetype);
              const mediaFilename = `${msg.id.id}${extension}`;
              const mediaPath = path.join(chatFolder, mediaFilename);
              
              // Save media file
              fs.writeFileSync(mediaPath, Buffer.from(media.data, 'base64'));
              mediaCount++;
              
              // Add media reference to message data
              messageData.mediaFile = mediaFilename;
              messageData.mimeType = media.mimetype;
            }
          } catch (mediaError) {
            // Check if it's the "webMediaType is invalid" error
            const errorMsg = mediaError.message || mediaError.toString();
            if (errorMsg.includes('webMediaType is invalid') || errorMsg.includes('interactive')) {
              console.log(`[WARN] Skipping unsupported/interactive media for message ${msg.id.id}`);
              messageData.mediaSkipped = 'Unsupported interactive media type';
            } else {
              console.error(`[ERROR] Failed to download media for message ${msg.id.id}:`, mediaError.message);
              messageData.mediaError = `Failed to download: ${mediaError.message}`;
            }
          }
        }
      }

      // Write chat messages to chat.txt
      const chatTextPath = path.join(chatFolder, 'chat.txt');
      fs.writeFileSync(chatTextPath, JSON.stringify(chatMessages, null, 2));
      
      console.log(`[DEBUG] Exported chat ${chatId}: ${messages.length} messages, ${mediaCount} media files`);
      
    } catch (chatError) {
      console.error(`[ERROR] Failed to process chat ${chatId}:`, chatError);
      
      // Create error file in chat folder
      const errorFolder = path.join(exportFolder, chatId.replace(/[^a-zA-Z0-9]/g, '_'));
      fs.mkdirSync(errorFolder, { recursive: true });
      fs.writeFileSync(
        path.join(errorFolder, 'error.txt'),
        `Failed to export this chat: ${chatError.message}`
      );
    }
  }

  // Create ZIP archive
  const zipFilename = `${exportId}.zip`;
  const zipPath = path.join(DOWNLOADS_DIR, zipFilename);
  
  console.log(`[DEBUG] Creating ZIP archive: ${zipPath}`);
  await createZipArchive(exportFolder, zipPath);
  
  // Clean up the temporary export folder
  try {
    fs.rmSync(exportFolder, { recursive: true, force: true });
    console.log(`[DEBUG] Cleaned up temporary folder: ${exportFolder}`);
  } catch (cleanupError) {
    console.error(`[ERROR] Failed to cleanup temp folder:`, cleanupError);
  }

  return {
    zipFilename,
    zipPath,
    downloadUrl: `/downloads/${zipFilename}`,
    exportedChats: chatIds.length
  };
}

/**
 * Fetch ONLY received messages (not sent by us) for multiple chats and export as ZIP
 * @param {string} clientId - Client ID
 * @param {Array<string>} chatIds - Array of chat IDs to export
 * @returns {Promise<Object>} - Export details with download URL
 */
async function fetchReceivedMessagesOnly(clientId, chatIds) {
  const entry = clients.get(clientId);
  if (!entry) throw new Error('client not found');
  if (entry.status !== 'ready') throw new Error('client not ready');

  const client = entry.client;
  const exportId = `export_received_${Date.now()}`;
  const exportFolder = path.join(DOWNLOADS_DIR, exportId);
  
  // Create main export folder
  fs.mkdirSync(exportFolder, { recursive: true });
  
  console.log(`[DEBUG] Starting export of RECEIVED messages only for ${chatIds.length} chats to ${exportFolder}`);

  for (const chatId of chatIds) {
    try {
      console.log(`[DEBUG] Processing chat: ${chatId}`);
      
      // Create folder for this chat
      const chatFolder = path.join(exportFolder, chatId.replace(/[^a-zA-Z0-9]/g, '_'));
      fs.mkdirSync(chatFolder, { recursive: true });

      // Fetch the chat
      const chat = await client.getChatById(chatId);
      
      // Fetch messages (adjust limit as needed)
      const messages = await chat.fetchMessages({ limit: 10000 });
      console.log(`[DEBUG] Fetched ${messages.length} total messages for chat ${chatId}`);

      // Filter only received messages (fromMe = false)
      const receivedMessages = messages.filter(msg => !msg.fromMe);
      console.log(`[DEBUG] Filtered to ${receivedMessages.length} received messages (excluding sent messages)`);

      const chatMessages = [];
      let mediaCount = 0;

      for (const msg of receivedMessages) {
        // Collect message data
        const messageData = {
          id: msg.id.id,
          timestamp: msg.timestamp,
          body: msg.body,
          from: msg.from,
          to: msg.to,
          fromMe: msg.fromMe, // Will always be false
          type: msg.type,
          hasMedia: msg.hasMedia
        };

        chatMessages.push(messageData);

        // Download media if present
        if (msg.hasMedia) {
          // Check if this is a downloadable media type
          let shouldSkip = false;
          let skipReason = '';
          
          try {
            // Skip unsupported message types (interactive, buttons, polls, etc.)
            const unsupportedTypes = ['interactive', 'buttons', 'list', 'poll', 'ciphertext', 'list_response', 'buttons_response'];
            if (unsupportedTypes.includes(msg.type)) {
              shouldSkip = true;
              skipReason = `Unsupported media type: ${msg.type}`;
            }
            
            // Additional check: inspect message object for interactive properties
            if (!shouldSkip && msg._data) {
              if (msg._data.isInteractive || msg._data.interactiveType) {
                shouldSkip = true;
                skipReason = 'Interactive message type detected in _data';
              }
              
              // Check for buttons/list in raw data
              if (msg._data.type === 'interactive' || msg._data.type === 'buttons' || msg._data.type === 'list') {
                shouldSkip = true;
                skipReason = `Interactive type in _data: ${msg._data.type}`;
              }
            }
            
            if (shouldSkip) {
              console.log(`[DEBUG] Skipping message ${msg.id.id}: ${skipReason}`);
              messageData.mediaSkipped = skipReason;
              continue;
            }
            
            console.log(`[DEBUG] Downloading media (type: ${msg.type}) for received message ${msg.id.id}`);
            const media = await msg.downloadMedia();
            
            if (media) {
              const extension = getExtensionFromMime(media.mimetype);
              const mediaFilename = `${msg.id.id}${extension}`;
              const mediaPath = path.join(chatFolder, mediaFilename);
              
              // Save media file
              fs.writeFileSync(mediaPath, Buffer.from(media.data, 'base64'));
              mediaCount++;
              
              // Add media reference to message data
              messageData.mediaFile = mediaFilename;
              messageData.mimeType = media.mimetype;
            }
          } catch (mediaError) {
            // Check if it's the "webMediaType is invalid" error
            const errorMsg = mediaError.message || mediaError.toString();
            if (errorMsg.includes('webMediaType is invalid') || errorMsg.includes('interactive')) {
              console.log(`[WARN] Skipping unsupported/interactive media for message ${msg.id.id}`);
              messageData.mediaSkipped = 'Unsupported interactive media type';
            } else {
              console.error(`[ERROR] Failed to download media for message ${msg.id.id}:`, mediaError.message);
              messageData.mediaError = `Failed to download: ${mediaError.message}`;
            }
          }
        }
      }

      // Write chat messages to chat.txt
      const chatTextPath = path.join(chatFolder, 'chat.txt');
      fs.writeFileSync(chatTextPath, JSON.stringify(chatMessages, null, 2));
      
      console.log(`[DEBUG] Exported received messages for chat ${chatId}: ${receivedMessages.length} messages (from ${messages.length} total), ${mediaCount} media files`);
      
    } catch (chatError) {
      console.error(`[ERROR] Failed to process chat ${chatId}:`, chatError);
      
      // Create error file in chat folder
      const errorFolder = path.join(exportFolder, chatId.replace(/[^a-zA-Z0-9]/g, '_'));
      fs.mkdirSync(errorFolder, { recursive: true });
      fs.writeFileSync(
        path.join(errorFolder, 'error.txt'),
        `Failed to export this chat: ${chatError.message}`
      );
    }
  }

  // Create ZIP archive
  const zipFilename = `${exportId}.zip`;
  const zipPath = path.join(DOWNLOADS_DIR, zipFilename);
  
  console.log(`[DEBUG] Creating ZIP archive: ${zipPath}`);
  await createZipArchive(exportFolder, zipPath);
  
  // Clean up the temporary export folder
  try {
    fs.rmSync(exportFolder, { recursive: true, force: true });
    console.log(`[DEBUG] Cleaned up temporary folder: ${exportFolder}`);
  } catch (cleanupError) {
    console.error(`[ERROR] Failed to cleanup temp folder:`, cleanupError);
  }

  return {
    zipFilename,
    zipPath,
    downloadUrl: `/downloads/${zipFilename}`,
    exportedChats: chatIds.length
  };
}

module.exports = {
  createClientEntry,
  getClientEntry,
  stopClient,
  deleteClient,
  listClients,
  sendMessage,
  getChatsAccordingToTime,
  fetchMessagesForChat,
  fetchReceivedMessagesOnly,
  getChatsWithReceivedAttachments
};
