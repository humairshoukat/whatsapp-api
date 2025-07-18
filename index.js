const express = require('express');
const cors = require('cors');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const multer = require('multer');
const fs = require('fs');
const rimraf = require('rimraf');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const mime = require('mime-types');
ffmpeg.setFfmpegPath(ffmpegPath);


// Ensure media directory exists
if (!fs.existsSync('./media')) fs.mkdirSync('./media');


// SQLite setup for QR code and whatsapp message storage
const db = new sqlite3.Database('whatsapp_session.db');
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS whatsapp_messages (
        id TEXT PRIMARY KEY,
        chat_id TEXT,
        from_me INTEGER,
        sender TEXT,
        timestamp INTEGER,
        body TEXT,
        type TEXT,
        has_media INTEGER,
        media_path TEXT
    )`);
});


// App setup (express/node)
const app = express();
app.use(cors());
const upload = multer({ dest: 'media/' });
app.use(express.json());
const PORT = process.env.PORT || 3000;


// WhatsApp client setup
let currentQr = null;
let connected = false;
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox']
    }
});


// ----------------- Custom functions ----------------->>>

const SESSION_DIR = path.join(__dirname, '.wwebjs_auth');
const CACHE_DIR = path.join(__dirname, '.wwebjs_cache');
const MEDIA_DIR = path.join(__dirname, 'media');
const DB_FILE = path.join(__dirname, 'whatsapp_session.db');

function cleanSessionFolder() {
    // Remove .wwebjs_auth directory
    if (fs.existsSync(SESSION_DIR)) {
        try {
            rimraf.sync(SESSION_DIR);
            // console.log('[session] Cleaned up .wwebjs_auth directory.');
        } catch (err) {
            console.error('[session] Failed to clean session dir:', err.message);
        }
    }

    // Remove .wwebjs_cache directory
    if (fs.existsSync(CACHE_DIR)) {
        try {
            rimraf.sync(CACHE_DIR);
            // console.log('[session] Cleaned up .wwebjs_cache directory.');
        } catch (err) {
            console.error('[session] Failed to clean cache dir:', err.message);
        }
    }

    // Remove media directory
    if (fs.existsSync(MEDIA_DIR)) {
        try {
            rimraf.sync(MEDIA_DIR);
            // console.log('[session] Cleaned up media directory.');
            fs.mkdirSync('./media');
        } catch (err) {
            console.error('[session] Failed to clean media dir:', err.message);
        }
    }

    // Remove all data from whatsapp_messages table
    if (fs.existsSync(DB_FILE)) {
        db.run("DELETE FROM whatsapp_messages", function(err) {
            if (err) {
                console.error('[session] Failed to delete all records from whatsapp_messages:', err.message);
            } else {
                // console.log('[session] All records deleted from whatsapp_messages.');
            }
        });
    }
}


// Save message to DB
function saveMessageToDb(msg, chatId, hasMedia=false, mediaPath=null) {
    db.run(
        `INSERT OR REPLACE INTO whatsapp_messages (id, chat_id, from_me, sender, timestamp, body, type, has_media, media_path)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            msg.id.id,
            chatId,
            msg.fromMe ? 1 : 0,
            msg.author || msg.from || null,
            msg.timestamp,
            msg.body || null,
            msg.type || null,
            hasMedia ? 1 : 0,
            mediaPath
        ]
    );
}

// Get message from DB
function getMessageByIdFromDb(msgId, cb) {
    db.get(`SELECT * FROM whatsapp_messages WHERE id = ?`, [msgId], (err, row) => cb(err, row));
}

// Function to remove bot contacts
function looksLikeBotOrMeta(name, number) {
    // Filter out Meta AI and bots by known names, numbers, or patterns
    const botKeywords = ['AI', 'Meta', 'Dungeon', 'robot', 'bee', 'detective', 'master', 'editor', 'starter', 'sidekick', 'tutor', 'coach', 'pro', 'chore', 'alien', 'd.i. whyer', 'chat noir', 'block', 'spark', 'whimsy', 'mentor', 'guru', 'bot', 'bee', 'game', 'stitchy', 'austen', 'doomy', 'noir', 'clef', 'alvin', 'coach', 'compassionate', 'career', 'footballer', 'homefinder', 'data', 'info', 'pro', 'tutor', 'genie', 'divine', 'guitar', 'riot', 'happiness', 'story', 'maestro', 'anchor', 'savant', 'vibe', 'mentor', 'bff', 'the', 'older', 'grandpa', 'pro', 'spark', 'blister', 'madame', 'pumpkin', 'rainbow', 'trivia', 'driven', 'game', 'sun', 'fleur', 'beeley', 'beekeeper', 'chair', 'block', 'ai', 'noir'];
    if (!name && !number) return true;
    name = (name || '').toLowerCase();
    for (const kw of botKeywords) {
        if (name.includes(kw.toLowerCase())) return true;
    }
    // Meta AI range is 13135550000-13135559999
    if (number && /^1313555\d{4,}$/.test(number)) return true;
    return false;
}


// ------------------ WhatsApp event listeners ---------------------->>>

client.on('qr', async (qr) => {
    currentQr = qr;
    console.log('[whatsapp-web.js] New QR code generated.');
});

client.on('authenticated', () => {
    console.log('[whatsapp-web.js] Authenticated');
});

client.on('ready', () => {
    connected = true;
    currentQr = null;
    console.log('[whatsapp-web.js] Client is ready!');
});

client.on('disconnected', async (reason) => {
    connected = false;
    console.log('[whatsapp-web.js] Disconnected:', reason);

    // Clean and re-initialize if LOGOUT
    if (reason === 'LOGOUT') {
        try {
            if (client.pupBrowser) {
                await client.pupBrowser.close(); // <-- ensure browser is closed!
            }
        } catch (err) {
            console.error('[whatsapp-web.js] Failed to close Puppeteer browser:', err.message);
        }

        try {
            cleanSessionFolder(); // Deletes .wwebjs_auth, .wwebjs_cache, media, whatsapp_session.db
            console.log('[whatsapp-web.js] Session cleaned due to LOGOUT. Re-initializing for new QR...');
            setTimeout(() => client.initialize(), 2000);
        } catch (err) {
            console.error('[whatsapp-web.js] Failed to reset session:', err.message);
        }
    }
});

client.on('message', async (msg) => {
    const chat = await msg.getChat();
    let hasMedia = false, mediaPath = null
    if (msg.hasMedia) {
        const media = await msg.downloadMedia();
        if (media) {
            const ext = media.mimetype.split('/')[1];
            let fname;
            if (msg.type === 'audio' || msg.type === 'ptt') {
                fname = `media/${msg.id.id}.ogg`;
            } else {
                fname = `media/${msg.id.id}.${ext}`;
            }
            fs.writeFileSync(fname, media.data, 'base64');
            hasMedia = true;
            mediaPath = fname;
        }
    }
    saveMessageToDb(msg, chat.id._serialized, hasMedia, mediaPath);
});

// Initialize the client
client.initialize();


// ----------------- API Routes ----------------->>>

// Root URL
app.get('/', (req, res) => {
    // res.json({
    //     "status": "OK"
    // })
    res.redirect('/docs');
});

// Get status (whatsapp-api)
app.get('/status', (req, res) => {
    res.json({
        connected,
        qr_code: currentQr ? true : false,
        timestamp: new Date().toISOString()
    });
});

// Get qr-code (text response)
app.get('/qr-code', async (req, res) => {
    if (!currentQr) {
        return res.status(404).json({ error: "No QR code available. Either already authenticated or client not ready." });
    }
    const qrCode = await qrcode.toDataURL(currentQr);
    res.json({ qr_code: qrCode });
});

// Get qr-code (image response)
app.get('/qr-code-image', async (req, res) => {
    if (!currentQr) {
        return res.status(404).json({ error: "No QR code available. Either already authenticated or client not ready." });
    }
    const img = await qrcode.toBuffer(currentQr, { type: 'png' });
    res.setHeader('Content-Type', 'image/png');
    res.send(img);
});

// List all contacts (filter MyContact and only @c.us)
app.get('/list-contacts', async (req, res) => {
    try {
        const contacts = await client.getContacts();
        const filtered = contacts.filter(c =>
            c.id._serialized.endsWith('@c.us') &&
            !looksLikeBotOrMeta(c.name, c.number) &&
            (
                c.id._serialized.endsWith('@c.us') &&
                c.isMyContact === true &&
                ((c.name && c.name.trim().length > 0) ||
                (c.pushname && c.pushname.trim().length > 0))

                // Only contacts with name, pushname, or your country prefix
                // (c.name && c.name.trim().length > 0) ||
                // (c.pushname && c.pushname.trim().length > 0) ||
                // (c.number && c.number.startsWith('92'))
            )
        );
        res.json(filtered.map(c => ({
            id: c.id._serialized,
            name: c.name || c.pushname || '',
            number: c.number || '',
            pushname: c.pushname || ''
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Search contacts (filter only @c.us and MyContact for saving)
app.get('/search-contacts', async (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    if (!q) return res.json([]);
    try {
        const contacts = await client.getContacts();
        const filtered = contacts.filter(c =>
            ((c.name && c.name.toLowerCase().includes(q)) ||
            (c.pushname && c.pushname.toLowerCase().includes(q)) ||
            (c.number && c.number.includes(q)) ||
            (c.id._serialized && c.id._serialized.includes(q)))
            && c.id._serialized.endsWith('@c.us')
            && c.isMyContact === true
        );
        res.json(filtered.map(c => ({
            id: c.id._serialized,
            name: c.name || '',
            number: c.number || '',
            pushname: c.pushname || ''
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List all messages for a chat
app.get('/list-messages', async (req, res) => {
    const chat_id = req.query.chat_id;
    const limit = parseInt(req.query.limit) || 50;
    if (!chat_id) return res.status(400).json({ error: "chat_id required" });

    const msg_type = ['chat', 'document', 'image', 'audio', 'ptt', 'video'];
    try {
        const chat = await client.getChatById(chat_id);
        const msgs = await chat.fetchMessages({ limit });

        // Async map for messages
        const result = await Promise.all(msgs.map(async (msg) => {
            if (!msg_type.includes(msg.type)) return null;

            // Check msg in the DB
            let dbMsg = await new Promise((resolve) =>
                getMessageByIdFromDb(msg.id.id, (err, row) => resolve(row))
            );

            let mediaPath = null;
            let hasMedia = false;

            if (dbMsg && dbMsg.media_path) {
                mediaPath = dbMsg.media_path; // Already in DB, use that mediaPath
            } else {
                if (msg.hasMedia) {
                    const media = await msg.downloadMedia();
                    if (media && media.data) {
                        const ext = media.mimetype.split('/')[1];
                        let fname;
                        if (msg.type === 'audio' || msg.type === 'ptt') {
                            fname = `media/${msg.id.id}.ogg`;
                        } else {
                            fname = `media/${msg.id.id}.${ext}`;
                        }
                        fs.writeFileSync(fname, media.data, 'base64');
                        hasMedia = true;
                        mediaPath = fname;
                    }
                }
                // Always save to DB (update or insert)
                saveMessageToDb(msg, chat.id._serialized, hasMedia, mediaPath);
            }

            return {
                id: msg.id.id,
                from: msg.from,
                to: msg.to,
                timestamp: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : null,
                body: msg.body,
                type: msg.type,
                hasMedia: msg.hasMedia,
                mediaPath
            };
        }));

        res.json(result.filter(item => item != null));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List recent messages
app.get('/recent-messages', (req, res) => {
    db.all(
        `SELECT * FROM whatsapp_messages ORDER BY timestamp DESC LIMIT 50`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

// List recent status messages
app.get('/recent-statuses', (req, res) => {
    db.all(
        `SELECT * FROM whatsapp_messages WHERE chat_id='status@broadcast' ORDER BY timestamp DESC LIMIT 50`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

// Get media URL
app.get('/stream-url/:msgid', async (req, res) => {
    const msgId = req.params.msgid;

    // Check msg in the DB
    let dbMsg = await new Promise((resolve) =>
        getMessageByIdFromDb(msgId, (err, row) => resolve(row))
    );

    if (!dbMsg || !dbMsg.media_path) {
        return res.status(404).json({ error: 'Media file not found' });
    }

    const filePath = dbMsg.media_path;
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Media file not found' });
    }

    res.json({
        "status": "OK",
        "hasMedia": true,
        "mediaPath": filePath
    });

});

// Media Streaming / Download endpoint
app.get('/media/:msgid', async (req, res) => {
    const msgId = req.params.msgid;

    // Check msg in the DB
    let dbMsg = await new Promise((resolve) =>
        getMessageByIdFromDb(msgId, (err, row) => resolve(row))
    );

    if (!dbMsg || !dbMsg.media_path) {
        return res.status(404).json({ error: 'Media file not found' });
    }

    const filePath = dbMsg.media_path;
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Media file not found' });
    }

    // AUDIO (stream .ogg)
    if (['audio', 'ptt'].includes(dbMsg.type)) {
        res.setHeader('Content-Type', 'audio/ogg');
        fs.createReadStream(filePath).pipe(res);
    
    // IMAGE (jpeg/png/webp)
    } else if (dbMsg.type === 'image') {
        const ext = path.extname(filePath).slice(1);
        res.setHeader('Content-Type', mime.lookup(ext) || 'image/jpeg');
        fs.createReadStream(filePath).pipe(res);
    
    // VIDEO (stream .mp4)
    } else if (dbMsg.type === 'video') {
        var stat = fs.statSync(filePath);
        var total = stat.size;
        if (req.headers['range']) {
            var range = req.headers.range;
            var parts = range.replace(/bytes=/, "").split("-");
            var partialstart = parts[0];
            var partialend = parts[1];

            var start = parseInt(partialstart, 10);
            var end = partialend ? parseInt(partialend, 10) : total-1;
            var chunksize = (end-start)+1;

            var file = fs.createReadStream(filePath, {start: start, end: end});
            res.writeHead(206, { 
                'Content-Range': 'bytes ' + start + '-' + end + '/' + total, 
                'Accept-Ranges': 'bytes', 
                'Content-Length': chunksize, 
                'Content-Type': 'video/mp4' 
            });
            file.pipe(res);
        } else {
            res.writeHead(200, { 
                'Content-Length': total, 
                'Content-Type': 'video/mp4' 
            });
            fs.createReadStream(filePath).pipe(res);
        }

    // Document or Unknown: stream as attachment / download
    } else {
        const ext = path.extname(filePath).slice(1);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
        fs.createReadStream(filePath).pipe(res);
    }
});

// Get all the current chats (including groups)
app.get('/list-chats', async (req, res) => {
    try {
        let chats = await client.getChats();
        res.json(chats.map(chat => ({
            id: chat.id._serialized,
            name: chat.name || chat.formattedTitle || "",
            last_message_time: chat.timestamp ? new Date(chat.timestamp * 1000).toISOString() : null,
            last_message: chat.lastMessage?.body || null,
            unread_count: chat.unreadCount || 0,
            is_group: chat.isGroup
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List unread chats
app.get('/unread-chats', async (req, res) => {
    try {
        let chats = await client.getChats();

        // Filter chats with unread messages, then map
        const result = chats
            .filter(chat => chat.unreadCount > 0)
            .map(chat => ({
                id: chat.id._serialized,
                name: chat.name || chat.formattedTitle || "",
                last_message_time: chat.timestamp ? new Date(chat.timestamp * 1000).toISOString() : null,
                last_message: chat.lastMessage?.body || null,
                unread_count: chat.unreadCount,
                is_group: chat.isGroup
            }));

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get individual chat by chat_id
app.get('/get-chat', async (req, res) => {
    const chat_id = req.query.chat_id;
    if (!chat_id) return res.status(400).json({ error: "chat_id required" });
    try {
        const chat = await client.getChatById(chat_id);
        res.json({
            id: chat.id._serialized,
            name: chat.name || chat.formattedTitle || "",
            last_message_time: chat.timestamp ? new Date(chat.timestamp * 1000).toISOString() : null,
            last_message: chat.lastMessage?.body || null,
            unread_count: chat.unreadCount || 0,
            is_group: chat.isGroup
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get all chats for a contact
app.get('/get-contact-chats', async (req, res) => {
    const contact_id = req.query.contact_id;
    if (!contact_id) return res.status(400).json({ error: "contact_id required" });
    try {
        const chats = await client.getChats();
        const result = chats.filter(chat =>
            (!chat.isGroup && chat.id._serialized === contact_id) ||
            (chat.isGroup && chat.participants && chat.participants.some(p => p.id._serialized === contact_id))
        );
        res.json(result.map(chat => ({
            id: chat.id._serialized,
            name: chat.name || chat.formattedTitle || "",
            last_message_time: chat.timestamp ? new Date(chat.timestamp * 1000).toISOString() : null,
            last_message: chat.lastMessage?.body || null,
            unread_count: chat.unreadCount || 0,
            is_group: chat.isGroup
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get last interaction with a contact
app.get('/get-last-interaction', async (req, res) => {
    const contact_id = req.query.contact_id;
    if (!contact_id) return res.status(400).json({ error: "contact_id required" });
    db.get(
        `SELECT * FROM whatsapp_messages WHERE sender = ? OR chat_id = ? ORDER BY timestamp DESC LIMIT 1`,
        [contact_id, contact_id],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: "No messages found" });
            res.json(row);
        }
    );
});

// Get message context
app.get('/get-message-context', async (req, res) => {
    const message_id = req.query.message_id;
    const radius = parseInt(req.query.radius) || 5;
    if (!message_id) return res.status(400).json({ error: "message_id required" });
    db.get(`SELECT * FROM whatsapp_messages WHERE id = ?`, [message_id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: "Message not found" });
        const start = row.timestamp - radius * 60;
        const end = row.timestamp + radius * 60;
        db.all(
            `SELECT * FROM whatsapp_messages WHERE chat_id = ? AND timestamp BETWEEN ? AND ? ORDER BY timestamp ASC`,
            [row.chat_id, start, end],
            (err2, rows) => {
                if (err2) return res.status(500).json({ error: err2.message });
                res.json(rows);
            }
        );
    });
});

// Send message
app.post('/send-message', async (req, res) => {
    if (!connected) return res.status(400).json({ error: "Not connected to WhatsApp" });
    const { to, message } = req.body;
    if (!to || !message) return res.status(400).json({ error: "Missing to or message" });
    try {
        const chatId = to.replace(/[^0-9]/g, "") + "@c.us";
        const msg = await client.sendMessage(chatId, message);
        res.json({
            success: true,
            message_id: msg.id.id,
            recipient: to,
            sent_at: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ error: "Failed to send message", detail: err.message });
    }
});

// Send file/media
app.post('/send-file', upload.single('file'), async (req, res) => {
    if (!connected) return res.status(400).json({ error: "Not connected to WhatsApp" });
    const to = req.body.to;
    const caption = req.body.caption || '';
    if (!to || !req.file) return res.status(400).json({ error: "Missing to or file" });

    const chatId = to.replace(/[^0-9]/g, "") + "@c.us";
    const filePath = req.file.path;
    try {
        const media = MessageMedia.fromFilePath(filePath);
        const msg = await client.sendMessage(chatId, media, { caption });
        res.json({
            success: true,
            message_id: msg.id.id,
            recipient: to,
            filename: req.file.originalname,
            sent_at: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({ error: "Failed to send file", detail: err.message });
    }
});

// Send audio message as voice note
app.post('/send-audio-message', upload.single('file'), async (req, res) => {
    if (!connected) return res.status(400).json({ error: "Not connected to WhatsApp" });
    const to = req.body.to;
    if (!to || !req.file) return res.status(400).json({ error: "Missing to or file" });
    const chatId = to.replace(/[^0-9]/g, "") + "@c.us";
    const filePath = req.file.path;
    // Convert to .ogg opus (WhatsApp voice note)
    const oggPath = filePath + '.ogg';
    ffmpeg(filePath)
        .audioCodec('libopus')
        .format('ogg')
        .output(oggPath)
        .on('end', async () => {
            try {
                const media = MessageMedia.fromFilePath(oggPath);
                const msg = await client.sendMessage(chatId, media, { sendAudioAsVoice: true });
                res.json({
                    success: true,
                    message_id: msg.id.id,
                    recipient: to,
                    filename: req.file.originalname,
                    sent_at: new Date().toISOString()
                });
                fs.unlinkSync(filePath);
                fs.unlinkSync(oggPath);
            } catch (err) {
                res.status(500).json({ error: "Failed to send audio", detail: err.message });
            }
        })
        .on('error', err => {
            res.status(500).json({ error: "Failed to process audio", detail: err.message });
        })
        .run();
});

// Download media by message_id
app.get('/download-media', (req, res) => {
    const message_id = req.query.message_id;
    if (!message_id) return res.status(400).json({ error: "message_id required" });
    db.get(
        `SELECT * FROM whatsapp_messages WHERE id = ? AND has_media = 1`,
        [message_id],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row || !row.media_path) return res.status(404).json({ error: "Media not found" });
            res.download(row.media_path);
        }
    );
});

// Reconnect to WhatsApp
app.post('/reconnect', (req, res) => {
    try {
        client.destroy();
        connected = false;
        setTimeout(() => client.initialize(), 2000);
        res.json({ success: true, message: "Reconnection initiated" });
    } catch (err) {
        res.status(500).json({ error: "Failed to reconnect", detail: err.message });
    }
})

// Disconnect WhatsApp client session
app.post('/disconnect', async (req, res) => {
    try {
        await client.destroy();
        connected = false;
        res.json({ success: true, message: "WhatsApp client disconnected" });
        console.log('WhatsApp client disconnected');
    } catch (err) {
        res.status(500).json({ error: "Failed to disconnect", detail: err.message });
    }
});


// ----------------------------------------->>>


// Swagger UI
app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Start server
app.listen(PORT, () => {
    console.log(`WhatsApp REST API listening at http://0.0.0.0:${PORT}`);
    console.log(`Docs at http://localhost:${PORT}/docs`);
});
