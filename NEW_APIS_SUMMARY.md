# New APIs Summary

## 1. Export Received Messages Only

**Endpoint:** `POST /clients/:id/export-received-messages`

**Description:** Exports only messages and media that were received (sent to you), excluding all messages you sent.

**Request Body:**
```json
{
  "chatIds": ["919876543210@c.us", "918765432109@c.us"]
}
```

**Response:**
```json
{
  "success": true,
  "exportedChats": 2,
  "downloadUrl": "/downloads/export_received_1730738475000.zip",
  "zipFilename": "export_received_1730738475000.zip",
  "note": "Only received messages (not sent by you) are included in this export"
}
```

**Use Cases:**
- Extract only incoming content (messages/media sent to you)
- Backup photos/documents received from contacts
- Analyze customer messages without your replies
- Smaller export files (excludes your sent messages)

**Example:**
```bash
curl -X POST http://localhost:3000/clients/YOUR_CLIENT_ID/export-received-messages \
  -H "Content-Type: application/json" \
  -d '{"chatIds": ["919876543210@c.us"]}'
```

---

## 2. Get Chats With Received Attachments

**Endpoint:** `GET /clients/:id/chats-with-received-attachments`

**Description:** Returns only chat IDs where attachments (media files) were received within the time range. Excludes text-only messages.

**Query Parameters:**
- `time` - Hours (e.g., `1`, `24`, `48`) or `"all"` (default: `"all"`)

**Response:**
```json
{
  "clientId": "abc-123-def",
  "timeFilter": "24",
  "totalChats": 3,
  "chats": [
    {
      "chatId": "919876543210@c.us",
      "name": "John Doe",
      "receivedAttachmentsCount": 5
    },
    {
      "chatId": "918765432109@c.us",
      "name": "Jane Smith",
      "receivedAttachmentsCount": 2
    }
  ],
  "note": "Only chats with received attachments (media sent to you) are included"
}
```

**Filters:**
- ✅ `fromMe = false` (received, not sent)
- ✅ `hasMedia = true` (attachments only)
- ✅ Within time range
- ❌ Excludes group chats
- ❌ Excludes text-only messages

**Use Cases:**
- Find contacts who sent photos/documents
- Identify chats with media to export
- List customers who submitted attachments
- Filter chats for selective media backup

**Example:**
```bash
# Get chats with attachments received in last 24 hours
curl http://localhost:3000/clients/YOUR_CLIENT_ID/chats-with-received-attachments?time=24

# Get all chats with received attachments (any time)
curl http://localhost:3000/clients/YOUR_CLIENT_ID/chats-with-received-attachments
```

---

## Combined Workflow Example

```bash
# Step 1: Find chats that received attachments in last 24h
curl http://localhost:3000/clients/CLIENT_ID/chats-with-received-attachments?time=24

# Step 2: Export only received messages from those chats
curl -X POST http://localhost:3000/clients/CLIENT_ID/export-received-messages \
  -H "Content-Type: application/json" \
  -d '{
    "chatIds": ["919876543210@c.us", "918765432109@c.us"]
  }'

# Result: ZIP file with only attachments/messages people sent you in last 24h
```

---

## Comparison with Existing APIs

| API | What It Returns | Filters |
|-----|----------------|---------|
| `GET /clients/:id/chats` | All chats with activity | Time-based |
| `GET /clients/:id/chats-with-received-attachments` | Chats with received media | Time + fromMe=false + hasMedia=true |
| `POST /clients/:id/export-chats` | All messages (sent + received) | None |
| `POST /clients/:id/export-received-messages` | Only received messages | fromMe=false |

---

**Date Added:** November 5, 2025
