# WhatsApp REST API

A full-featured WhatsApp REST API built with [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js), with persistent storage and OpenAPI docs.

## Features

- WhatsApp login with persistent session (no QR every time)
- Send text, media, and voice messages
- Download received media
- List/search contacts, chats, and messages
- Swagger/OpenAPI docs (`/docs`)
- SQLite-backed message and QR code storage
- Ready for Docker deployment

## Usage

### 1. **Install dependencies**

```bash
npm install
