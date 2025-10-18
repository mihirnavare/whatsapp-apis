# WhatsApp Multi-Client Manager (Dev)

This repo provides a development server to create multiple whatsapp-web.js clients (with LocalAuth per clientId), display QR codes, and send messages (including media) via each client. Designed to run in Docker or the VSCode devcontainer.

## Quick start (docker-compose)

1. Copy `.env.example` to `.env` and edit if desired.
2. Build and run:
   ```bash
   docker compose up --build
