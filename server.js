const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const socketIo = require('socket.io');
const http = require('http');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(cookieParser()); // Use cookie-parser middleware

const upload = multer({ dest: 'uploads/' });

const clients = new Map(); // Store clients for each session

const createClient = (sessionId) => {
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: sessionId }), // Create a unique clientId for each session
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            headless: true,
            timeout: 60000, // 60 seconds
        },
        webVersionCache: {
            type: "remote",
            remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
        },
    });

    client.on('qr', (qr) => {
        io.to(sessionId).emit('qr', qr); // Emit the QR code to the specific client
    });

    client.on('ready', () => {
        io.to(sessionId).emit('ready');
    });

    client.on('message', msg => {
        if (msg.body === '!ping') {
            msg.reply('pong');
        }
    });

    client.on('disconnected', (reason) => {
        console.log('Client was logged out', reason);
        clients.delete(sessionId);
    });

    client.on('error', (error) => {
        console.error('Client error:', error);
        clients.delete(sessionId);
    });

    client.on('auth_failure', (msg) => {
        console.error('AUTHENTICATION FAILURE', msg);
        clients.delete(sessionId);
    });

    client.initialize();
    return client;
};

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    // Parse cookies from socket handshake headers
    const cookies = parseCookies(socket.handshake.headers.cookie);
    let sessionId = cookies.sessionId;

    if (!sessionId) {
        // Generate new session ID if not present
        sessionId = uuidv4();
        socket.emit('set-cookie', { sessionId });
    }

    if (!clients.has(sessionId)) {
        const client = createClient(sessionId);
        clients.set(sessionId, client);
    }

    socket.on('send-message', (data) => {
        const client = clients.get(sessionId);
        if (!client) {
            socket.emit('status', 'Client not initialized.');
            return;
        }

        const { message, numbers } = data;
        const phoneNumbers = numbers.split(',').map(number => `${number.trim()}@c.us`);

        const results = [];

        const sendMessages = async () => {
            for (const number of phoneNumbers) {
                try {
                    await client.sendMessage(number, message);
                    results.push(`Message sent to ${number}`);
                } catch (err) {
                    results.push(`Failed to send message to ${number}: ${err}`);
                }
            }
            socket.emit('status', results.join('\n'));
        };

        sendMessages();
    });

    socket.on('send-file', (data) => {
        const client = clients.get(sessionId);
        if (!client) {
            socket.emit('status', 'Client not initialized.');
            return;
        }

        const { message, numbers, file, fileName, mimeType } = data;
        const phoneNumbers = numbers.split(',').map(number => `${number.trim()}@c.us`);
        const media = new MessageMedia(mimeType, file, fileName);

        const results = [];

        const sendFiles = async () => {
            for (const number of phoneNumbers) {
                try {
                    await client.sendMessage(number, media, { caption: message });
                    results.push(`File sent to ${number}`);
                } catch (err) {
                    results.push(`Failed to send file to ${number}: ${err}`);
                }
            }
            socket.emit('status', results.join('\n'));
        };

        sendFiles();
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        const client = clients.get(sessionId);
        if (client) {
            client.destroy();
            clients.delete(sessionId);
        }
    });
});

app.get('/', (req, res) => {
    let sessionId = req.cookies.sessionId;
    if (!sessionId) {
        sessionId = uuidv4();
        res.cookie('sessionId', sessionId, { httpOnly: true });
    }
    res.render('index');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

// Helper function to parse cookies
function parseCookies(cookieHeader) {
    const cookies = {};
    cookieHeader?.split(';').forEach(cookie => {
        const [name, value] = cookie.split('=').map(c => c.trim());
        cookies[name] = value;
    });
    return cookies;
}
