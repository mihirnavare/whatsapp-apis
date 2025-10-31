# Network-Accessible Downloads - Implementation Guide

## Overview
This document describes the network-accessible download system implemented for the WhatsApp API backend. Users can now download exported ZIP files from any device on the network, not just localhost.

---

## ✅ What Was Implemented

### 1. Secure Download Endpoint (`/downloads/:filename`)

**Location:** `/app/src/routes.js`

**Features:**
- ✅ Path traversal prevention using `path.basename()`
- ✅ File type validation (only `.zip` files allowed)
- ✅ File existence checking with helpful error messages
- ✅ File size limit enforcement (500MB max)
- ✅ Proper HTTP headers for downloads
- ✅ CORS headers for cross-origin access
- ✅ Comprehensive logging of all download attempts
- ✅ Error handling with appropriate status codes

**Security Measures:**
```javascript
// Prevents ../../../etc/passwd attacks
const sanitizedFilename = path.basename(filename);

// Only allow ZIP files
if (!filename.endsWith('.zip')) {
  return res.status(400).json({ error: 'Invalid file type' });
}

// Check file size limit (500MB)
if (stats.size > MAX_DOWNLOAD_SIZE) {
  return res.status(413).json({ error: 'File too large' });
}
```

**HTTP Status Codes:**
- `200` - File found, download started
- `400` - Invalid filename or file type
- `404` - File not found or expired
- `413` - File too large
- `500` - Server error

---

### 2. Network Binding Configuration

**Location:** `/app/src/server.js`

**Server Binding:**
```javascript
const HOST = process.env.HOST || '0.0.0.0';
const PORT = process.env.PORT || 3000;

app.listen(PORT, HOST, () => {
  console.log(`Server listening at http://${HOST}:${PORT}`);
  console.log(`Server bound to all network interfaces (0.0.0.0)`);
});
```

**Why This Matters:**
- `0.0.0.0` binds to ALL network interfaces
- `127.0.0.1` would only allow localhost access
- This enables access from other devices on the network

---

### 3. CORS Configuration for Downloads

**Location:** `/app/src/server.js`

**Enhanced CORS:**
```javascript
app.use(cors({ 
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Owner'],
  exposedHeaders: ['Content-Disposition', 'Content-Length'] // ← Added for downloads
}));
```

**Why `exposedHeaders` is Critical:**
- Browsers need access to `Content-Disposition` for download filenames
- `Content-Length` helps show download progress
- Without this, downloads may fail in cross-origin scenarios

---

### 4. Automatic File Cleanup (Cron Job)

**Location:** `/app/src/server.js`

**Features:**
- ✅ Runs every hour (`0 * * * *`)
- ✅ Deletes files older than 48 hours (configurable)
- ✅ Only cleans `.zip` files (exports)
- ✅ Logs all deletions with file size and age
- ✅ Reports freed disk space

**Configuration:**
```bash
# .env file
EXPORT_RETENTION_HOURS=48  # Default: 48 hours
```

**Cron Schedule:**
```javascript
// Runs at the start of every hour (e.g., 1:00, 2:00, 3:00)
cron.schedule('0 * * * *', async () => {
  // Cleanup logic
});
```

**Sample Log Output:**
```
[CLEANUP] Starting export files cleanup...
[CLEANUP] Deleted expired export: export_1234567.zip (15.5MB, age: 50.2h)
[CLEANUP] Completed: Deleted 3 file(s), freed 45.20MB
```

---

### 5. Comprehensive Logging

**Download Request Logging:**
```
[DOWNLOAD] IP: 192.168.10.150, File: export_123.zip, Time: 2025-10-29T10:30:45.000Z
[DOWNLOAD SUCCESS] File: export_123.zip, Size: 15.50MB, Client: 192.168.10.150
```

**Error Logging:**
```
[DOWNLOAD ERROR] File not found: export_456.zip
[DOWNLOAD ERROR] Invalid file type requested: malicious.exe
[DOWNLOAD ERROR] File too large: huge_export.zip (600000000 bytes)
```

**Cleanup Logging:**
```
[CLEANUP] Starting export files cleanup...
[CLEANUP] Deleted expired export: export_789.zip (10.2MB, age: 49.5h)
[CLEANUP] Completed: Deleted 2 file(s), freed 25.70MB
```

---

### 6. Updated Export Response

**Location:** `/app/src/clientsRegistry.js`

**Change:**
```javascript
// OLD
downloadUrl: `/media/${zipFilename}`

// NEW
downloadUrl: `/downloads/${zipFilename}`
```

**Response Format:**
```json
{
  "success": true,
  "exportedChats": 5,
  "downloadUrl": "/downloads/export_1234567890.zip",
  "zipFilename": "export_1234567890.zip"
}
```

**Frontend Integration:**
The frontend constructs full URLs:
```javascript
const API_BASE = "http://192.168.10.146:3000";
const fullDownloadUrl = `${API_BASE}${downloadUrl}`;
// Result: http://192.168.10.146:3000/downloads/export_1234567890.zip
```

---

### 7. Environment Variables

**Location:** `/app/.env.example`

**New Variables:**
```bash
# Server binding (CRITICAL for network access)
HOST=0.0.0.0                    # Bind to all interfaces
PORT=3000                       # Server port

# Export configuration
EXPORT_RETENTION_HOURS=48       # File retention before cleanup
MAX_EXPORT_SIZE_MB=500          # Maximum download size

# Session configuration
SESSION_EXPIRY_HOURS=6          # WhatsApp session expiry

# CORS
CORS_ORIGIN=*                   # Allow all origins (dev only)

# Puppeteer
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

---

### 8. Network Testing Script

**Location:** `/app/test-network-downloads.sh`

**Usage:**
```bash
# Default (uses 192.168.10.146:3000)
./test-network-downloads.sh

# Custom server IP and port
SERVER_IP=192.168.1.100 PORT=4999 ./test-network-downloads.sh
```

**What It Tests:**
1. ✅ Server accessibility from network
2. ✅ Download endpoint availability
3. ✅ CORS headers presence
4. ✅ Content-Type and Content-Disposition headers
5. ✅ Network binding verification (0.0.0.0 vs 127.0.0.1)
6. ✅ Localhost vs network IP comparison
7. ✅ Actual download test (if exports exist)

**Sample Output:**
```
==============================================
Network-Accessible Downloads Test
==============================================
Server IP: 192.168.10.146
Port: 3000

Test 1: Server Accessibility
---------------------------------------------
✅ Server is accessible from network (HTTP 200)

Test 2: Download Endpoint Availability
---------------------------------------------
✅ Download endpoint working - file not found (HTTP 404)
   Note: 404 means endpoint works, just test file doesn't exist

Test 3: CORS Configuration
---------------------------------------------
✅ CORS headers present:
   access-control-allow-origin: *

...
```

---

## 📋 Installation & Setup

### Step 1: Install Dependencies

```bash
npm install
```

**New Dependency Added:**
- `node-cron@^3.0.3` - For scheduled file cleanup

### Step 2: Configure Environment

```bash
# Create .env file from example
cp .env.example .env

# Edit .env to ensure network binding
nano .env
```

**Critical Setting:**
```bash
HOST=0.0.0.0  # ← MUST be 0.0.0.0 for network access
```

### Step 3: Start Server

```bash
npm start
```

**Verify Startup Logs:**
```
Server listening at http://0.0.0.0:3000
Server bound to all network interfaces (0.0.0.0) - accessible from network
Export retention: 48 hours
Session expiry: 6 hours
Downloads directory: /app/src/downloads
```

### Step 4: Test Network Access

```bash
# Run the test script
./test-network-downloads.sh

# Or with custom IP/port
SERVER_IP=192.168.1.100 PORT=3000 ./test-network-downloads.sh
```

---

## 🔥 Firewall Configuration

### Linux (Ubuntu/Debian)

```bash
# Check current firewall status
sudo ufw status

# Allow port 3000
sudo ufw allow 3000/tcp

# Reload firewall
sudo ufw reload

# Verify
sudo ufw status numbered
```

### Linux (CentOS/RHEL)

```bash
# Allow port 3000
sudo firewall-cmd --add-port=3000/tcp --permanent
sudo firewall-cmd --reload

# Verify
sudo firewall-cmd --list-ports
```

### Docker (if using docker-compose)

```yaml
# Ensure ports are properly mapped
ports:
  - "3000:3000"  # Host:Container
```

---

## 🧪 Testing Downloads

### Test 1: Browser Test (from another device)

```
Open: http://192.168.10.146:3000/downloads/export_1234567890.zip
Expected: File download starts or 404 error
```

### Test 2: cURL Test

```bash
# From another device on the network
curl -I http://192.168.10.146:3000/downloads/export_1234567890.zip

# Expected headers:
# HTTP/1.1 200 OK
# Content-Type: application/zip
# Content-Disposition: attachment; filename="export_1234567890.zip"
# Access-Control-Allow-Origin: *
```

### Test 3: Full Download Test

```bash
# Download actual file
curl -O http://192.168.10.146:3000/downloads/export_1234567890.zip

# Verify file
ls -lh export_1234567890.zip
unzip -l export_1234567890.zip
```

### Test 4: Frontend Integration Test

```javascript
// In Streamlit or React frontend
const API_BASE = "http://192.168.10.146:3000";

// Export chats
const response = await fetch(`${API_BASE}/clients/${clientId}/export-chats`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chatIds: ['123@c.us'] })
});

const data = await response.json();
// data.downloadUrl = "/downloads/export_1234567890.zip"

// Construct full download URL
const downloadUrl = `${API_BASE}${data.downloadUrl}`;
// Result: http://192.168.10.146:3000/downloads/export_1234567890.zip

// Trigger download
window.open(downloadUrl, '_blank');
```

---

## 🔍 Troubleshooting

### Issue: "Connection Refused" from Other Devices

**Symptoms:**
- Downloads work on localhost
- Downloads fail from other devices
- `curl` shows "Connection refused"

**Solution:**
```bash
# 1. Check server binding
netstat -tuln | grep 3000
# Should show: 0.0.0.0:3000, NOT 127.0.0.1:3000

# 2. Check .env file
cat .env | grep HOST
# Should show: HOST=0.0.0.0

# 3. Restart server
npm start
```

---

### Issue: Downloads Work but Return 404

**Symptoms:**
- Server is accessible
- Endpoint responds
- All exports return 404

**Solution:**
```bash
# Check if exports directory exists and has files
ls -la src/downloads/

# Check file permissions
ls -l src/downloads/*.zip

# Check logs for cleanup messages
# Files may have been deleted by cleanup cron
```

---

### Issue: CORS Errors in Browser Console

**Symptoms:**
```
Access to XMLHttpRequest has been blocked by CORS policy
```

**Solution:**
1. Verify CORS headers in response:
```bash
curl -I -H "Origin: http://example.com" \
  http://192.168.10.146:3000/downloads/export_123.zip | grep -i access-control
```

2. Ensure `exposedHeaders` includes `Content-Disposition` in `server.js`

3. Restart server after CORS changes

---

### Issue: Files Deleted Too Quickly

**Symptoms:**
- Export completes
- Download URL works initially
- Later, file is missing (404)

**Solution:**
```bash
# Increase retention time in .env
EXPORT_RETENTION_HOURS=72  # 3 days instead of 2

# Restart server
npm start
```

---

### Issue: Large Files Fail to Download

**Symptoms:**
- Small exports work
- Large exports timeout or return 413

**Solution:**
```bash
# Increase size limit in routes.js
const MAX_DOWNLOAD_SIZE = 1000 * 1024 * 1024; // 1GB

# Or in .env
MAX_EXPORT_SIZE_MB=1000
```

---

## 📊 API Endpoint Reference

### Download Endpoint

**GET** `/downloads/:filename`

**Parameters:**
- `filename` (path parameter) - Name of the ZIP file to download

**Response Codes:**
- `200` - File found, download starts (returns binary ZIP data)
- `400` - Invalid filename or file type
- `404` - File not found or expired
- `413` - File exceeds size limit (500MB)
- `500` - Server error during download

**Success Response:**
```
HTTP/1.1 200 OK
Content-Type: application/zip
Content-Disposition: attachment; filename="export_1234567890.zip"
Content-Length: 15728640
Access-Control-Allow-Origin: *
Access-Control-Expose-Headers: Content-Disposition

[Binary ZIP data]
```

**Error Response (404):**
```json
{
  "success": false,
  "error": "File not found. It may have expired (files are kept for 48 hours)."
}
```

**Error Response (400):**
```json
{
  "success": false,
  "error": "Invalid file type. Only ZIP files are allowed."
}
```

---

## 🔒 Security Features

### 1. Path Traversal Prevention
```javascript
// Input: "../../../etc/passwd"
const sanitizedFilename = path.basename(filename);
// Output: "passwd" (directory traversal removed)
```

### 2. File Type Validation
```javascript
// Only .zip files allowed
if (!filename.endsWith('.zip')) {
  return res.status(400).json({ error: 'Invalid file type' });
}
```

### 3. File Size Limits
```javascript
// Default 500MB limit
const MAX_DOWNLOAD_SIZE = 500 * 1024 * 1024;
if (stats.size > MAX_DOWNLOAD_SIZE) {
  return res.status(413).json({ error: 'File too large' });
}
```

### 4. Automatic Cleanup
- Files older than 48 hours are automatically deleted
- Prevents disk space exhaustion
- Reduces exposure window for sensitive data

### 5. Comprehensive Logging
- All download attempts logged with IP addresses
- Failed access attempts tracked
- Audit trail for security reviews

---

## 📝 Migration Notes

### Breaking Changes
- Export download URLs changed from `/media/:filename` to `/downloads/:filename`
- Old `/media/:filename` endpoint still works for backward compatibility

### Frontend Updates Required
If your frontend hardcodes URLs:
```javascript
// OLD
const url = `http://localhost:3000/media/${filename}`;

// NEW
const url = `http://192.168.10.146:3000/downloads/${filename}`;
```

**Better Approach (No Changes Needed):**
```javascript
// Use API base URL + relative path from response
const API_BASE = process.env.REACT_APP_API_BASE;
const url = `${API_BASE}${response.downloadUrl}`;
```

---

## 📈 Monitoring & Maintenance

### Log Monitoring

**Watch download activity:**
```bash
# Follow server logs
npm start | grep DOWNLOAD

# Or if using PM2
pm2 logs | grep DOWNLOAD
```

**Check cleanup activity:**
```bash
npm start | grep CLEANUP
```

### Disk Space Monitoring

```bash
# Check downloads directory size
du -sh src/downloads/

# List all export files
ls -lh src/downloads/*.zip

# Count export files
ls src/downloads/*.zip | wc -l
```

### Manual Cleanup

```bash
# Delete all exports older than 2 days
find src/downloads -name "*.zip" -type f -mtime +2 -delete

# Delete all exports (fresh start)
rm -f src/downloads/*.zip
```

---

## 🎯 Quick Reference

### Common Commands

```bash
# Start server
npm start

# Test network access
./test-network-downloads.sh

# Check server binding
netstat -tuln | grep 3000

# Allow firewall
sudo ufw allow 3000/tcp

# View logs
npm start | grep -E "DOWNLOAD|CLEANUP"

# Check disk usage
du -sh src/downloads/

# Manual cleanup
find src/downloads -name "*.zip" -mtime +2 -delete
```

### Important Files

- `/app/src/server.js` - Server configuration & cleanup cron
- `/app/src/routes.js` - Download endpoint implementation
- `/app/src/clientsRegistry.js` - Export logic & response format
- `/app/.env.example` - Environment variable reference
- `/app/test-network-downloads.sh` - Network testing script

---

## ✅ Implementation Checklist

- [x] Server binds to 0.0.0.0 (all network interfaces)
- [x] `/downloads/:filename` endpoint with security
- [x] CORS headers properly configured
- [x] Path traversal prevention
- [x] File type validation (ZIP only)
- [x] File size limits enforced
- [x] Automatic cleanup cron job (48-hour retention)
- [x] Comprehensive logging (downloads & errors)
- [x] Error responses with helpful messages
- [x] Environment variables documented
- [x] Network testing script created
- [x] Legacy `/media/:filename` endpoint preserved

---

## 🚀 Next Steps

1. **Install Dependencies:**
   ```bash
   npm install
   ```

2. **Verify Configuration:**
   ```bash
   cat .env | grep HOST  # Should be 0.0.0.0
   ```

3. **Start Server:**
   ```bash
   npm start
   ```

4. **Run Network Test:**
   ```bash
   SERVER_IP=<your-ip> ./test-network-downloads.sh
   ```

5. **Test from Another Device:**
   - Open browser on different device
   - Navigate to: `http://<server-ip>:3000/downloads/export_xxx.zip`

6. **Update Frontend:**
   - Ensure API base URL uses network IP, not localhost
   - Use relative download URLs from API responses

---

**Version:** 1.0.0  
**Date:** October 29, 2025  
**Status:** ✅ Fully Implemented & Tested
