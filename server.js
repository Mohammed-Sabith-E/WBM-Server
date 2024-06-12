const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const socketIo = require('socket.io');
const http = require('http');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: '*', // Allow requests from any origin
        methods: ['GET', 'POST'] // Allow only GET and POST requests
    }
});

// Enable CORS for all routes
// app.use(cors({ origin: 'http://127.0.0.1:5502' }));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

const client = new Client({
    authStrategy: new LocalAuth(),
    webVersionCache: {
        type: "remote",
        remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
    },
});

client.on('ready', () => {
    io.emit('ready', 'WhatsApp is ready!');
    io.emit('message', 'WhatsApp is ready!');
});

client.on('authenticated', () => {
    io.emit('authenticated', 'WhatsApp authenticated!');
    io.emit('message', 'WhatsApp authenticated!');
});

client.on('auth_failure', (msg) => {
    io.emit('message', 'Authentication failure, restarting...');
});

client.on('disconnected', (reason) => {
    io.emit('message', 'WhatsApp is disconnected!');
    client.initialize();
});

client.initialize();

io.on('connection', (socket) => {
    console.log('A user connected');

    socket.on('send-message', ({ phoneNumbers, message }) => {
        const numbersArray = phoneNumbers.split(',').map(number => number.trim() + '@c.us');
        const results = [];

        const sendMessages = async () => {
            for (const number of numbersArray) {
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

    // Modify the socket.on('request-qr') function
    socket.on('request-qr', (userID) => {
        if (client.info && client.info.wid) {
            socket.emit('message', 'Already authenticated');
        } else {
            // Generate a unique QR code based on the userID
            const qrContent = `YourUserID:${userID}`; // Customize QR content as needed
            qrcode.toDataURL(qrContent, (err, url) => {
                if (err) {
                    socket.emit('message', 'Failed to generate QR code');
                } else {
                    socket.emit('qr', url);
                    socket.emit('message', 'Scan QR code to authenticate');
                }
            });
        }
    });
});

app.post('/send-file', upload.single('file'), async (req, res) => {
    const message = req.body.message;
    let phoneNumbers = req.body.phoneNumbers; // Make sure phoneNumbers is always a string or an array


    console.log(phoneNumbers);
    // Check if phoneNumbers is not a string or an array, convert it to an empty string
    if (typeof phoneNumbers !== 'string' && !Array.isArray(phoneNumbers)) {
        phoneNumbers = '';
    }

    const filePath = req.file ? req.file.path : null; // Check if a file is uploaded
    const fileName = req.file ? req.file.originalname : null; // Check if a file is uploaded
    const mimeType = req.file ? req.file.mimetype : null; // Check if a file is uploaded

    let numbersArray = [];
    if (typeof phoneNumbers === 'string') {
        // If phoneNumbers is a string, split it and trim each number
        numbersArray = phoneNumbers.split(',').map(number => number.trim() + '@c.us');
    } else if (Array.isArray(phoneNumbers)) {
        // If phoneNumbers is an array, trim each number
        numbersArray = phoneNumbers.map(number => number.trim() + '@c.us');
    }

    const results = [];

    // If no file is uploaded, handle sending messages without media
    if (!filePath) {
        for (const number of numbersArray) {
            try {
                await client.sendMessage(number, message);
                results.push(`Message sent to ${number}`);
            } catch (err) {
                results.push(`Failed to send message to ${number}: ${err}`);
            }
        }

        res.json({ status: results });
        return; // Exit the function early since there's no file to process
    }

    // Process the file
    fs.readFile(filePath, 'base64', async (err, data) => {
        if (err) {
            return res.json({ status: `Failed to read file: ${err}` });
        }

        const media = new MessageMedia(mimeType, data, fileName);

        for (const number of numbersArray) {
            try {
                await client.sendMessage(number, media, { caption: message });
                results.push(`Message sent to ${number}`);
            } catch (err) {
                results.push(`Failed to send message to ${number}: ${err}`);
            }
        }

        res.json({ status: results });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
