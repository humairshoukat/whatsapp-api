# WhatsApp REST API

A full-featured WhatsApp REST API built with [whatsapp-web.js](https://github.com/pedroslopez/whatsapp-web.js), supporting persistent session storage, SQLite integration, media handling, and automatic OpenAPI (Swagger) documentation.

---

## Features 🚀

- **Scan QR & Stay Connected:** Persistent WhatsApp Web session; QR only required at first login or after logout.
- **Send Text, Files & Audio:** Send text, images, video, documents, and WhatsApp voice notes (auto-converts audio to .ogg/opus).
- **Download Media:** Retrieve and download any received WhatsApp media via API.
- **List & Search:** Search contacts, list all chats, fetch messages, find group/individual chats, and more.
- **Context & Analytics:** Fetch message context (before/after), last interactions, and chat/contact metadata.
- **RESTful & Documented:** All endpoints available via REST and browsable Swagger UI.
- **Health Checks/Status, Reconnect & Disconnect:** Includes status, Reconnect, and disconnect endpoints.
- **SQLite Storage:** Persists QR codes and messages, supporting history and offline media access.
- **Docker Ready:** One-step deployment with Docker.

---

## 🏁 Quickstart

### 1. **Clone the repo & install dependencies**

```bash
git clone https://github.com/humairshoukat/whatsapp-api
cd whatsapp-api
npm install
```

### 2. **Start the server**
```bash
npm index.js
```

- Server run on:  http://localhost:8000

### 2. **Open Swagger UI docs**

- Browse and try the API in your browser: http://localhost:8000/docs

---

## 🧑‍💻 API Usage

- On first run, visit /qr-code or /docs and scan the QR code using WhatsApp on your phone (Linked Devices > Link a Device).
- Session will be saved (no QR next time unless you logout on your phone).

## Key API Endpoints

| Method | Endpoint                                    | Description                               |
| ------ | ------------------------------------------- | ----------------------------------------- |
| GET    | /status                                     | Connection status                         |
| GET    | /qr-code                                    | QR code as image (base64 data URL)        |
| GET    | /qr-code-image                              | QR code as PNG image                      |
| GET    | /search-contacts?q=...                      | Search for contacts                       |
| GET    | /list-chats                                 | List all chats                            |
| GET    | /list-messages?chat\_id=...                 | List messages for a chat                  |
| GET    | /get-chat?chat\_id=...                      | Get a specific chat's info                |
| GET    | /get-direct-chat-by-contact?contact\_id=... | Find direct chat with a contact           |
| GET    | /get-contact-chats?contact\_id=...          | List all chats for a contact              |
| GET    | /get-last-interaction?contact\_id=...       | Most recent message with a contact        |
| GET    | /get-message-context?message\_id=...        | Message context (radius in minutes)       |
| POST   | /send-message                               | Send a text message                       |
| POST   | /send-file                                  | Send a media file                         |
| POST   | /send-audio-message                         | Send an audio file as WhatsApp voice note |
| GET    | /download-media?message\_id=...             | Download media by message ID              |
| GET    | /health                                     | Health check                              |
| POST   | /reconnect                                  | Force reconnect to WhatsApp               |
| POST   | /shutdown                                   | Graceful server shutdown                  |

- Full request/response schemas in http://localhost:8000/docs.

---

## 🐳 Docker

- Build and run using docker:

``` bash
docker build -t whatsapp-api .
docker run -p 8000:8000 \
    -v ${PWD}/media:/app/media \
    -v ${PWD}/whatsapp_session.db:/app/whatsapp_session.db \
    whatsapp-api
```

---

## 🗃️ File/Folder Structure

whatsapp-api/
├── index.js
├── package.json
├── swagger.json
├── Dockerfile
├── media/                 # auto-created, stores received media
└── whatsapp_session.db    # auto-created, stores session/messages

---

## 📝 License (MIT)

**Enjoy your Free WhatsApp REST API!**