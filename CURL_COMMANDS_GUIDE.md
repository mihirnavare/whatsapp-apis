# Step-by-Step cURL Commands for Testing WhatsApp Chat Export

This guide provides all the cURL commands needed to test the chat export functionality from start to finish.

## Prerequisites

- Server running on `http://localhost:3000`
- `jq` installed for JSON parsing (optional but recommended)
- Your phone ready to scan WhatsApp QR code

---

## Step 1: Start a New Session

```bash
curl -X POST http://localhost:3000/clients/start \
  -H "Content-Type: application/json" \
  -d '{"owner": "test-user"}'
```

**Expected Response:**
```json
{
  "clientId": "abc-123-def-456",
  "status": "initializing",
  "expiresAt": 1698765432123
}
```

**Save the `clientId`** - you'll need it for all subsequent commands!

```bash
# Set as environment variable for easy reuse
export CLIENT_ID="abc-123-def-456"
```

---

## Step 2: Check Status and Get QR Code

Wait 2-3 seconds, then check status:

```bash
curl -s http://localhost:3000/clients/$CLIENT_ID/status | jq '.'
```

**Expected Response (when QR is ready):**
```json
{
  "clientId": "abc-123-def-456",
  "owner": "test-user",
  "status": "qr",
  "qr": "data:image/png;base64,iVBORw0KG...",
  "createdAt": 1698765432123,
  "expiresAt": 1698786432123,
  "lastSeen": 1698765432123
}
```

### View QR Code

**Option A: Save QR code to file**
```bash
curl -s http://localhost:3000/clients/$CLIENT_ID/status | \
  jq -r '.qr' > qr_code.txt

# Open qr_code.txt in a browser to see the QR code
```

**Option B: Extract and open QR in browser (Linux)**
```bash
curl -s http://localhost:3000/clients/$CLIENT_ID/status | \
  jq -r '.qr' | xargs -I {} echo {} > qr.html && xdg-open qr.html
```

### Scan the QR Code
1. Open WhatsApp on your phone
2. Go to **Settings** → **Linked Devices**
3. Tap **Link a Device**
4. Scan the QR code displayed

---

## Step 3: Wait for Authentication

Keep checking status until it becomes "ready":

```bash
# Check every few seconds
curl -s http://localhost:3000/clients/$CLIENT_ID/status | jq '.status'
```

**Status progression:**
- `qr` → waiting for scan
- `authenticated` → QR scanned, setting up
- `ready` → ✅ Ready to use!

**Keep checking until you see:**
```json
"ready"
```

---

## Step 4: Verify Session is Ready

```bash
curl -s http://localhost:3000/clients/$CLIENT_ID/status | jq '.'
```

**Expected Response:**
```json
{
  "clientId": "abc-123-def-456",
  "owner": "test-user",
  "status": "ready",
  "qr": null,
  "createdAt": 1698765432123,
  "expiresAt": 1698786432123,
  "lastSeen": 1698765500000
}
```

---

## Step 5: List All Active Sessions (Optional)

```bash
curl -s http://localhost:3000/clients | jq '.'
```

---

## Step 6: Get Chats with Time Filters

### 6a. Get ALL Chats (No Time Filter)

```bash
curl -s "http://localhost:3000/clients/$CLIENT_ID/chats?time=all" | jq '.'
```

**Expected Response:**
```json
{
  "clientId": "abc-123-def-456",
  "timeFilter": "all",
  "totalChats": 15,
  "chats": [
    {
      "chatId": "1234567890@c.us",
      "name": "John Doe",
      "lastMessageTime": 1698765432
    },
    {
      "chatId": "0987654321@c.us",
      "name": "Jane Smith",
      "lastMessageTime": 1698754321
    }
  ]
}
```

### 6b. Get Chats from Last 24 Hours

```bash
curl -s "http://localhost:3000/clients/$CLIENT_ID/chats?time=24" | jq '.'
```

### 6c. Get Chats from Last Hour

```bash
curl -s "http://localhost:3000/clients/$CLIENT_ID/chats?time=1" | jq '.'
```

### 6d. Get Chats from Last Week (168 hours)

```bash
curl -s "http://localhost:3000/clients/$CLIENT_ID/chats?time=168" | jq '.'
```

### 6e. Get Chats from Last 48 Hours

```bash
curl -s "http://localhost:3000/clients/$CLIENT_ID/chats?time=48" | jq '.'
```

---

## Step 7: View Chat List

Display just the chat names and IDs:

```bash
curl -s "http://localhost:3000/clients/$CLIENT_ID/chats?time=all" | \
  jq -r '.chats[] | "\(.name) - \(.chatId)"'
```

**Save chat count:**
```bash
TOTAL_CHATS=$(curl -s "http://localhost:3000/clients/$CLIENT_ID/chats?time=all" | jq -r '.totalChats')
echo "Total chats: $TOTAL_CHATS"
```

---

## Step 8: Export Specific Chats

### 8a. Export First 2 Chats

```bash
# Get first 2 chat IDs automatically
CHAT_IDS=$(curl -s "http://localhost:3000/clients/$CLIENT_ID/chats?time=all" | \
  jq -c '[.chats[0:2][].chatId]')

echo "Exporting chat IDs: $CHAT_IDS"

# Export the chats
curl -X POST http://localhost:3000/clients/$CLIENT_ID/export-chats \
  -H "Content-Type: application/json" \
  -d "{\"chatIds\": $CHAT_IDS}" | jq '.'
```

### 8b. Export Specific Chat IDs (Manual)

Replace with your actual chat IDs:

```bash
curl -X POST http://localhost:3000/clients/$CLIENT_ID/export-chats \
  -H "Content-Type: application/json" \
  -d '{
    "chatIds": [
      "1234567890@c.us",
      "0987654321@c.us"
    ]
  }' | jq '.'
```

### 8c. Export ALL Chats

⚠️ **Warning:** This may take a long time if you have many chats!

```bash
# Get all chat IDs
ALL_CHAT_IDS=$(curl -s "http://localhost:3000/clients/$CLIENT_ID/chats?time=all" | \
  jq -c '[.chats[].chatId]')

# Export all
curl -X POST http://localhost:3000/clients/$CLIENT_ID/export-chats \
  -H "Content-Type: application/json" \
  -d "{\"chatIds\": $ALL_CHAT_IDS}" | jq '.'
```

**Expected Response:**
```json
{
  "success": true,
  "exportedChats": 2,
  "downloadUrl": "/media/export_1698765432123.zip",
  "zipFilename": "export_1698765432123.zip"
}
```

**Save the download URL:**
```bash
DOWNLOAD_URL=$(curl -s -X POST http://localhost:3000/clients/$CLIENT_ID/export-chats \
  -H "Content-Type: application/json" \
  -d "{\"chatIds\": $CHAT_IDS}" | jq -r '.downloadUrl')

ZIP_FILENAME=$(echo $DOWNLOAD_URL | sed 's/.*\///')
echo "Download URL: $DOWNLOAD_URL"
echo "ZIP Filename: $ZIP_FILENAME"
```

---

## Step 9: Download the Export ZIP File

```bash
# Using the saved variables
curl -o $ZIP_FILENAME http://localhost:3000$DOWNLOAD_URL
```

**Or with explicit filename:**
```bash
curl -o export_1698765432123.zip http://localhost:3000/media/export_1698765432123.zip
```

**Check file size:**
```bash
ls -lh $ZIP_FILENAME
```

---

## Step 10: Extract and View Contents

### Extract the ZIP

```bash
unzip $ZIP_FILENAME -d exported_chats
```

### View Structure

```bash
# List all files
find exported_chats -type f

# Or with tree (if installed)
tree exported_chats
```

### View Chat Messages

```bash
# View first chat's messages
cat exported_chats/*/chat.txt | jq '.[0:5]'

# Count messages in a chat
cat exported_chats/1234567890_c_us/chat.txt | jq '. | length'

# View all media files
find exported_chats -type f ! -name "chat.txt"
```

---

## Step 11: Stop/Delete Session (Cleanup)

```bash
curl -X DELETE http://localhost:3000/clients/$CLIENT_ID | jq '.'
```

**Expected Response:**
```json
{
  "deleted": true,
  "clientId": "abc-123-def-456"
}
```

---

## Complete Test Script (Copy-Paste)

Here's everything in one script you can copy and run:

```bash
#!/bin/bash

# Start session
echo "1. Starting session..."
RESPONSE=$(curl -s -X POST http://localhost:3000/clients/start \
  -H "Content-Type: application/json" \
  -d '{"owner": "test-user"}')
echo $RESPONSE | jq '.'

# Extract client ID
CLIENT_ID=$(echo $RESPONSE | jq -r '.clientId')
echo "Client ID: $CLIENT_ID"
echo ""

# Wait for QR
echo "2. Waiting for QR code..."
sleep 3

curl -s http://localhost:3000/clients/$CLIENT_ID/status | jq -r '.qr' > qr.txt
echo "QR code saved to qr.txt - Open in browser and scan!"
echo ""

# Wait for ready
echo "3. Waiting for authentication (scan QR code now)..."
while true; do
  STATUS=$(curl -s http://localhost:3000/clients/$CLIENT_ID/status | jq -r '.status')
  echo "Status: $STATUS"
  if [ "$STATUS" == "ready" ]; then
    break
  fi
  sleep 3
done
echo "✓ Ready!"
echo ""

# Get chats
echo "4. Getting chats..."
curl -s "http://localhost:3000/clients/$CLIENT_ID/chats?time=all" | jq '.'
echo ""

# Export first 2 chats
echo "5. Exporting first 2 chats..."
CHAT_IDS=$(curl -s "http://localhost:3000/clients/$CLIENT_ID/chats?time=all" | \
  jq -c '[.chats[0:2][].chatId]')

EXPORT_RESPONSE=$(curl -s -X POST http://localhost:3000/clients/$CLIENT_ID/export-chats \
  -H "Content-Type: application/json" \
  -d "{\"chatIds\": $CHAT_IDS}")

echo $EXPORT_RESPONSE | jq '.'

# Download ZIP
DOWNLOAD_URL=$(echo $EXPORT_RESPONSE | jq -r '.downloadUrl')
ZIP_FILENAME=$(echo $EXPORT_RESPONSE | jq -r '.zipFilename')

echo ""
echo "6. Downloading export..."
curl -o $ZIP_FILENAME http://localhost:3000$DOWNLOAD_URL

echo "✓ Downloaded: $ZIP_FILENAME"
ls -lh $ZIP_FILENAME

echo ""
echo "7. Extracting..."
unzip -q $ZIP_FILENAME -d exported_chats
echo "✓ Extracted to: exported_chats/"

echo ""
echo "Test complete!"
```

---

## Troubleshooting Commands

### Check if server is running
```bash
curl -s http://localhost:3000/clients
```

### Check client status
```bash
curl -s http://localhost:3000/clients/$CLIENT_ID/status | jq '.status'
```

### View server logs
```bash
# If running with docker-compose
docker-compose logs -f

# If running with npm
# Check the terminal where you ran npm start
```

### Test with a single chat
```bash
# Export just one chat
curl -X POST http://localhost:3000/clients/$CLIENT_ID/export-chats \
  -H "Content-Type: application/json" \
  -d '{"chatIds": ["1234567890@c.us"]}' | jq '.'
```

---

## Quick Reference

| Action | Command |
|--------|---------|
| Start session | `curl -X POST http://localhost:3000/clients/start -H "Content-Type: application/json" -d '{"owner": "test"}'` |
| Get status | `curl http://localhost:3000/clients/$CLIENT_ID/status` |
| List all chats | `curl "http://localhost:3000/clients/$CLIENT_ID/chats?time=all"` |
| Export chats | `curl -X POST http://localhost:3000/clients/$CLIENT_ID/export-chats -H "Content-Type: application/json" -d '{"chatIds": ["..."]}'` |
| Download ZIP | `curl -O http://localhost:3000/media/export_XXX.zip` |
| Delete session | `curl -X DELETE http://localhost:3000/clients/$CLIENT_ID` |

---

## Time Filter Values

- `1` - Last 1 hour
- `6` - Last 6 hours
- `24` - Last 24 hours (1 day)
- `48` - Last 48 hours (2 days)
- `72` - Last 72 hours (3 days)
- `168` - Last 168 hours (1 week)
- `336` - Last 336 hours (2 weeks)
- `720` - Last 720 hours (30 days)
- `all` - All chats (no time filter)
