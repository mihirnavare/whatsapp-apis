# WhatsApp Web API - Code Documentation

## Project Structure

```
/app/src/
├── server.js           # Main Express server entry point
├── routes.js           # API route definitions and handlers
├── clientsRegistry.js  # WhatsApp client management and session handling
├── utils.js           # Utility functions for file operations
├── data/              # Persistent data storage (volume mounted)
├── downloads/         # Media file storage
└── .wwebjs_auth/      # WhatsApp Web.js authentication data
```

## Module Documentation

### 1. server.js
**Purpose**: Main application entry point and Express server configuration

#### Key Responsibilities:
- Sets up Express server with middleware
- Configures CORS for cross-origin requests
- Implements automatic session cleanup
- Defines server host, port, and session expiry settings

#### Key Components:
```javascript
// Middleware Setup
app.use(express.json({ limit: '30mb' }));     // Large JSON payloads for media
app.use(express.urlencoded({ extended: true, limit: '30mb' }));
app.use(morgan('dev'));                       // HTTP request logging
app.use(cors({ origin: '*' }));              // CORS (dev configuration)

// Routes
app.use('/', routes);                         // Mount all API routes

// Automatic Cleanup
setInterval(async () => {
  // Removes expired sessions every minute
}, 60 * 1000);
```

#### Environment Variables:
- `PORT` (default: 3000) - Server port
- `HOST` (default: 0.0.0.0) - Server bind address
- `SESSION_EXPIRY_HOURS` (default: 6) - Session timeout

#### Dependencies:
- `express` - Web framework
- `morgan` - HTTP request logger
- `cors` - Cross-origin resource sharing
- `dotenv` - Environment variable loading

---

### 2. routes.js
**Purpose**: API endpoint definitions and request handling logic

#### Key Responsibilities:
- Defines all REST API endpoints
- Handles request validation and error responses
- Manages media file processing
- Coordinates with clientsRegistry for session operations

#### Endpoints Overview:
```javascript
POST   /clients/start          # Create new WhatsApp session
GET    /clients/:id/status     # Get session status and QR code
POST   /clients/:id/send       # Send message/media
POST   /clients/:id/stop       # Stop session (legacy)
DELETE /clients/:id            # Delete session (RESTful)
GET    /clients               # List all sessions
GET    /media/:filename       # Serve media files
```

#### Media Processing:
```javascript
// Supports multiple media input formats:
// 1. Object format: { filename, mime, base64 }
// 2. Data URL format: "data:image/jpeg;base64,..."
// 3. Automatic file saving for reference
```

#### Error Handling:
- Validates required fields (phone number)
- Handles client not found scenarios
- Catches and logs all exceptions
- Returns consistent error response format

#### Dependencies:
- `express.Router()` - Route handling
- `path` - File path operations
- `fs` - File system operations

---

### 3. clientsRegistry.js
**Purpose**: Core WhatsApp session management and client lifecycle

#### Key Responsibilities:
- Creates and manages WhatsApp Web.js client instances
- Handles authentication flow and QR code generation
- Manages session persistence and cleanup
- Provides message sending functionality

#### Data Structure:
```javascript
// In-memory clients Map:
clientId -> {
  client: WhatsAppClient,     // whatsapp-web.js instance
  clientId: "uuid",           // Unique session identifier
  owner: "string",            // Session owner identifier
  status: "string",           // Current session state
  createdAt: timestamp,       // Session creation time
  expiresAt: timestamp,       // Session expiration time
  qrDataUrl: "string",        // Base64 QR code image
  lastSeen: timestamp         // Last activity timestamp
}
```

#### Session States:
1. **initializing** - Client being set up
2. **qr** - QR code available for scanning
3. **authenticated** - User scanned QR code
4. **ready** - Session active, can send messages
5. **auth_failure** - Authentication failed
6. **disconnected** - Session terminated

#### WhatsApp Web.js Configuration:
```javascript
new Client({
  authStrategy: new LocalAuth({ clientId }),
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
```

#### Key Functions:

##### `createClientEntry(owner, expiryMs)`
- Creates new WhatsApp client instance
- Sets up event handlers for authentication flow
- Returns entry object with client metadata
- Initializes client and starts authentication

##### `getClientEntry(clientId)`
- Retrieves client entry from registry
- Returns null if client doesn't exist

##### `stopClient(clientId)` / `deleteClient(clientId)`
- Destroys WhatsApp client instance
- Removes client from registry
- Cleans up authentication data
- Attempts to remove local auth folder

##### `sendMessage(clientId, phone, message, media)`
- Validates client exists and is ready
- Formats phone number to WhatsApp format (@c.us)
- Handles both text and media messages
- Returns WhatsApp message response

##### `listClients()`
- Returns array of all client metadata
- Excludes sensitive client instances
- Provides overview of all sessions

#### Dependencies:
- `whatsapp-web.js` - WhatsApp Web automation
- `qrcode` - QR code generation
- `uuid` - Unique ID generation
- `path` & `fs` - File system operations

---

### 4. utils.js
**Purpose**: Utility functions for file operations and media handling

#### Key Responsibilities:
- Handles base64 to file conversion
- Manages downloads directory
- Provides file system utilities

#### Functions:

##### `saveBase64ToFile(base64, filename)`
- Converts base64 string to binary file
- Saves file to downloads directory
- Returns full file path
- Creates directory if it doesn't exist

#### Constants:
- `DOWNLOADS_DIR` - Absolute path to downloads folder
- Automatically creates directory structure

#### Dependencies:
- `fs` - File system operations
- `path` - Path manipulation

---

## Data Flow Architecture

### 1. Session Creation Flow
```
Client Request → routes.js → clientsRegistry.createClientEntry()
                ↓
WhatsApp Web.js Client Creation → Puppeteer Browser Launch
                ↓
QR Code Generation → Event Handler Updates
                ↓
Client Response ← Session Entry Data
```

### 2. Message Sending Flow
```
Client Request → routes.js → Media Processing (if present)
                ↓
clientsRegistry.sendMessage() → WhatsApp Client Validation
                ↓
Message Formatting → WhatsApp Web.js Send
                ↓
Response ← WhatsApp Message ID
```

### 3. Session Cleanup Flow
```
Timer Trigger → server.js cleanup interval
                ↓
listClients() → Check expiration times
                ↓
stopClient() → Destroy expired sessions
                ↓
File Cleanup → Remove auth data
```

## Security Considerations

### Current Security Model:
- **No Authentication**: API is open access
- **Owner-based Separation**: Sessions tagged by owner
- **Local File Access**: Media files served directly
- **CORS Wide Open**: Allows all origins (development setting)

### Production Security Recommendations:
1. **Implement API Authentication**:
   - JWT tokens or API keys
   - Rate limiting per user
   - Session ownership validation

2. **Secure CORS Configuration**:
   ```javascript
   app.use(cors({ 
     origin: ['https://yourdomain.com'],
     credentials: true 
   }));
   ```

3. **File Upload Security**:
   - Validate file types and sizes
   - Scan uploads for malware
   - Use secure file storage (S3, etc.)

4. **Environment Hardening**:
   - Use secrets management
   - Enable HTTPS/TLS
   - Implement proper logging and monitoring

## Performance Considerations

### Memory Management:
- **In-Memory Storage**: All sessions stored in RAM
- **Session Limits**: No built-in session count limits
- **Cleanup**: Automatic expired session removal

### Scalability Limitations:
- **Single Process**: No horizontal scaling support
- **Browser Instances**: Each session requires Puppeteer instance
- **File Storage**: Local file system only

### Production Scaling Recommendations:
1. **Database Integration**:
   - Replace Map with Redis/MongoDB
   - Persistent session storage
   - Multi-instance support

2. **Load Balancing**:
   - Session affinity required
   - Shared storage for auth data
   - Health check endpoints

3. **Resource Optimization**:
   - Connection pooling
   - Browser instance limits
   - Memory usage monitoring

## Docker Configuration

### Container Setup:
- **Base Image**: Node.js with Chromium
- **Volume Mounts**: 
  - `/app/data` - Session persistence
  - `/app/src/downloads` - Media files
- **Network**: Exposes port 3000
- **Environment**: Debian GNU/Linux 11 (bullseye)

### Development vs Production:
- **Development**: Local file storage, wide CORS
- **Production**: Requires external storage, security hardening

## Dependencies Analysis

### Core Dependencies:
```json
{
  "whatsapp-web.js": "^1.x.x",    // WhatsApp automation
  "express": "^4.x.x",            // Web framework
  "puppeteer": "^13.x.x",         // Browser automation
  "qrcode": "^1.x.x",             // QR code generation
  "uuid": "^8.x.x",               // Unique ID generation
  "morgan": "^1.x.x",             // HTTP logging
  "cors": "^2.x.x",               // CORS handling
  "dotenv": "^16.x.x"             // Environment variables
}
```

### System Dependencies:
- **Chromium Browser**: For WhatsApp Web automation
- **Node.js**: Runtime environment
- **Linux Packages**: Various system libraries for Puppeteer

## Testing Strategy

### Current State:
- **No Automated Tests**: Application lacks test coverage
- **Manual Testing**: API endpoints tested manually

### Recommended Testing Approach:
1. **Unit Tests**:
   - `utils.js` functions
   - Route handlers (mocked dependencies)
   - Client registry functions

2. **Integration Tests**:
   - Full API endpoint testing
   - WhatsApp Web.js integration
   - File upload/download flows

3. **End-to-End Tests**:
   - Complete session lifecycle
   - Message sending verification
   - Error scenario handling

## Monitoring and Logging

### Current Logging:
- **Morgan**: HTTP request logging
- **Console**: Error and debug messages
- **WhatsApp Events**: Client state changes

### Production Monitoring Needs:
1. **Application Metrics**:
   - Active session count
   - Message throughput
   - Error rates

2. **System Metrics**:
   - Memory usage per session
   - Browser process monitoring
   - File system usage

3. **Business Metrics**:
   - Session success rates
   - Authentication failures
   - Message delivery rates

## Troubleshooting Guide

### Common Issues:
1. **Browser Launch Failures**:
   - Check Chromium installation
   - Verify Docker container permissions
   - Review Puppeteer arguments

2. **Authentication Problems**:
   - QR code generation failures
   - Session persistence issues
   - WhatsApp account limitations

3. **Message Sending Errors**:
   - Invalid phone number formats
   - Session not ready
   - Media encoding problems

4. **Performance Issues**:
   - Memory leaks from unclosed browsers
   - Accumulating expired sessions
   - Large file upload timeouts

### Debug Information:
- Enable detailed logging in production
- Monitor browser process lifecycle
- Track session state transitions
- Log media processing steps