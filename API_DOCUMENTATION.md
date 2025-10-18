# WhatsApp Web API Documentation

## Overview
This is a RESTful API service that provides WhatsApp Web functionality through the `whatsapp-web.js` library. The service allows you to manage multiple WhatsApp sessions, send messages, and handle media files.

## Base URL
```
http://localhost:3000
```

## Environment Variables
- `PORT` - Server port (default: 3000)
- `HOST` - Server host (default: 0.0.0.0)
- `SESSION_EXPIRY_HOURS` - Session expiry time in hours (default: 6)
- `PUPPETEER_EXECUTABLE_PATH` - Path to Chromium executable (default: /usr/bin/chromium)

## Authentication
Currently, the API does not implement authentication. The `owner` field is used for session management and can be passed in:
- Request body: `{ "owner": "user123" }`
- Header: `X-Owner: user123`
- Default: `anonymous`

## Endpoints

### 1. Start WhatsApp Session

**POST** `/clients/start`

Creates a new WhatsApp session and returns a client ID for subsequent operations.

#### Request Body
```json
{
  "owner": "string (optional)"
}
```

#### Request Headers
```
X-Owner: string (optional)
```

#### Response
```json
{
  "clientId": "uuid-string",
  "status": "initializing",
  "expiresAt": 1234567890123
}
```

#### Status Codes
- `200` - Session created successfully
- `500` - Internal server error

---

### 2. Get Session Status

**GET** `/clients/:id/status`

Retrieves the current status of a WhatsApp session, including QR code for authentication.

#### Parameters
- `id` (path) - Client ID returned from start endpoint

#### Response
```json
{
  "clientId": "uuid-string",
  "owner": "string",
  "status": "qr|authenticated|ready|auth_failure|disconnected",
  "qr": "data:image/png;base64,... (when status is 'qr')",
  "createdAt": 1234567890123,
  "expiresAt": 1234567890123,
  "lastSeen": 1234567890123
}
```

#### Status Codes
- `200` - Success
- `404` - Client not found

#### Session Status Values
- `initializing` - Session is being set up
- `qr` - QR code is available for scanning
- `authenticated` - User has scanned QR code
- `ready` - Session is active and ready to send messages
- `auth_failure` - Authentication failed
- `disconnected` - Session was disconnected

---

### 3. Send Message

**POST** `/clients/:id/send`

Sends a text message or media to a WhatsApp number.

#### Parameters
- `id` (path) - Client ID

#### Request Body
```json
{
  "phone": "1234567890",
  "message": "Hello World!",
  "media": {
    "filename": "image.jpg",
    "mime": "image/jpeg",
    "base64": "base64-encoded-data"
  }
}
```

#### Media Object (optional)
- `filename` - File name for the media
- `mime` - MIME type (e.g., "image/jpeg", "application/pdf")
- `base64` - Base64 encoded file data

#### Alternative Media Format
You can also pass media as a data URL string:
```json
{
  "phone": "1234567890",
  "message": "Check this out!",
  "media": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
}
```

#### Response
```json
{
  "success": true,
  "responseId": "message-id-from-whatsapp"
}
```

#### Status Codes
- `200` - Message sent successfully
- `400` - Bad request (missing phone number)
- `500` - Internal server error

---

### 4. Stop Session

**POST** `/clients/:id/stop`

Stops and destroys a WhatsApp session.

#### Parameters
- `id` (path) - Client ID

#### Response
```json
{
  "stopped": true
}
```

#### Status Codes
- `200` - Session stopped successfully
- `404` - Client not found
- `500` - Internal server error

---

### 5. Delete Session

**DELETE** `/clients/:id`

Deletes a WhatsApp session (alias for stop functionality with RESTful naming).

#### Parameters
- `id` (path) - Client ID

#### Response
```json
{
  "deleted": true,
  "clientId": "uuid-string"
}
```

#### Status Codes
- `200` - Session deleted successfully
- `404` - Client not found
- `500` - Internal server error

---

### 6. List All Sessions

**GET** `/clients`

Retrieves a list of all active WhatsApp sessions.

#### Response
```json
[
  {
    "clientId": "uuid-string",
    "owner": "string",
    "status": "ready",
    "createdAt": 1234567890123,
    "expiresAt": 1234567890123,
    "lastSeen": 1234567890123
  }
]
```

#### Status Codes
- `200` - Success

---

### 7. Get Media File

**GET** `/media/:filename`

Serves uploaded media files from the downloads directory.

#### Parameters
- `filename` (path) - Name of the media file

#### Response
- Binary file data with appropriate Content-Type header

#### Status Codes
- `200` - File found and served
- `404` - File not found

## Error Handling

All error responses follow this format:
```json
{
  "error": "Error message description"
}
```

Common error scenarios:
- Client not found (404)
- Session expired (handled automatically by cleanup)
- Authentication failures
- Network connectivity issues
- Invalid phone numbers
- Media processing errors

## Session Management

### Automatic Cleanup
- Sessions automatically expire after the configured time (default: 6 hours)
- A background process runs every minute to clean up expired sessions
- Expired sessions are automatically stopped and their auth data removed

### Session Persistence
- Session authentication data is stored in `.wwebjs_auth/` directory
- This allows sessions to persist across server restarts
- Each session gets its own subdirectory identified by client ID

## Usage Examples

### 1. Complete Flow Example
```bash
# 1. Start a new session
curl -X POST http://localhost:3000/clients/start \
  -H "Content-Type: application/json" \
  -d '{"owner": "user123"}'

# Response: {"clientId": "abc-123", "status": "initializing", "expiresAt": 1234567890}

# 2. Check status and get QR code
curl http://localhost:3000/clients/abc-123/status

# Response includes QR code when status is "qr"
# Scan QR code with WhatsApp mobile app

# 3. Send a text message
curl -X POST http://localhost:3000/clients/abc-123/send \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "1234567890",
    "message": "Hello from API!"
  }'

# 4. Send a message with media
curl -X POST http://localhost:3000/clients/abc-123/send \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "1234567890",
    "message": "Check this image!",
    "media": {
      "filename": "photo.jpg",
      "mime": "image/jpeg",
      "base64": "base64-encoded-image-data"
    }
  }'

# 5. Stop the session
curl -X DELETE http://localhost:3000/clients/abc-123
```

### 2. JavaScript Example
```javascript
const axios = require('axios');

class WhatsAppAPI {
  constructor(baseUrl = 'http://localhost:3000') {
    this.baseUrl = baseUrl;
  }

  async startSession(owner = 'default') {
    const response = await axios.post(`${this.baseUrl}/clients/start`, { owner });
    return response.data;
  }

  async getStatus(clientId) {
    const response = await axios.get(`${this.baseUrl}/clients/${clientId}/status`);
    return response.data;
  }

  async sendMessage(clientId, phone, message, media = null) {
    const payload = { phone, message };
    if (media) payload.media = media;
    
    const response = await axios.post(`${this.baseUrl}/clients/${clientId}/send`, payload);
    return response.data;
  }

  async deleteSession(clientId) {
    const response = await axios.delete(`${this.baseUrl}/clients/${clientId}`);
    return response.data;
  }
}

// Usage
const api = new WhatsAppAPI();

async function example() {
  // Start session
  const session = await api.startSession('user123');
  console.log('Session started:', session.clientId);

  // Wait for QR code
  let status = await api.getStatus(session.clientId);
  while (status.status === 'initializing') {
    await new Promise(resolve => setTimeout(resolve, 1000));
    status = await api.getStatus(session.clientId);
  }

  if (status.status === 'qr') {
    console.log('Scan this QR code:', status.qr);
  }

  // Send message when ready
  if (status.status === 'ready') {
    await api.sendMessage(session.clientId, '1234567890', 'Hello from Node.js!');
  }
}
```

## Rate Limiting & Best Practices

### Recommendations
- Don't create multiple sessions for the same WhatsApp number
- Wait for session to be 'ready' before sending messages
- Handle session expiration gracefully
- Implement proper error handling for network issues
- Use reasonable delays between messages to avoid WhatsApp rate limits
- Store client IDs securely if building a multi-user application

### WhatsApp Limitations
- Each WhatsApp number can only have one active session
- WhatsApp may temporarily ban numbers that send too many messages
- Large media files may take time to upload
- International numbers may have different formatting requirements

## Troubleshooting

### Common Issues
1. **QR Code not appearing**: Check that status is 'qr' and wait a few seconds
2. **Authentication failure**: QR code may have expired, restart the session
3. **Messages not sending**: Ensure session status is 'ready'
4. **Session disconnected**: Network issues or WhatsApp logged out from mobile
5. **Media upload failing**: Check base64 encoding and file size limits

### Debug Information
- Check server logs for detailed error messages
- Session status provides current state information
- Use the `/clients` endpoint to monitor all active sessions