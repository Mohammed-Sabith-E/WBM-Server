const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');

const app = express();
const port = 3000;

// Middleware to enable CORS
app.use(cors());

// Middleware to parse JSON bodies with increased limit
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

const upload = multer({ dest: 'uploads/' });

let clients = {};

// Function to initialize a client
function initializeClient(userid, res) {
    const client = new Client({
        authStrategy: new LocalAuth({ clientId: userid }),
        webVersionCache: {
            type: "remote",
            remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
        },
    });

    clients[userid] = client;

    client.on('qr', qr => {
        console.log(`Generating QR code for ${userid}`);
        qrcode.toDataURL(qr, (err, url) => {
            if (err) {
                if (!res.headersSent) {
                    res.status(500).send({ message: 'Error generating QR code' });
                }
            } else {
                if (!res.headersSent) {
                    res.status(200).send({ qr: url });
                }
            }
        });
    });

    client.on('ready', () => {
        console.log(`Client ${userid} is ready!`);
    });

    client.on('disconnected', (reason) => {
        console.log(`Client ${userid} disconnected: ${reason}`);
        delete clients[userid];
    });

    client.initialize();
}

// POST endpoint to receive userid and send QR code
app.post('/userid', (req, res) => {
    const { userid } = req.body;
    if (userid) {
        console.log(`Received userid: ${userid}`);
        if (!clients[userid]) {
            initializeClient(userid, res);
        } else {
            const client = clients[userid];
            if (client.info && client.info.pushname) {
                res.status(200).send({ message: 'Client already authenticated' });
            } else {
                initializeClient(userid, res);
            }
        }
    } else {
        res.status(400).send({ message: 'User ID is missing' });
    }
});

// POST endpoint to disconnect client
app.post('/disconnect', (req, res) => {
    const { userid } = req.body;
    const client = clients[userid];

    if (client) {
        client.destroy()
            .then(() => {
                delete clients[userid];
                res.status(200).send({ message: `Client ${userid} disconnected` });
                console.log(`Client ${userid} disconnected`);
            })
            .catch(err => {
                res.status(500).send({ message: `Failed to disconnect client ${userid}: ${err}` });
            });
    } else {
        res.status(400).send({ message: 'Client not found or not initialized' });
    }
});

// POST endpoint to send message
app.post('/send-file', upload.single('file'), async (req, res) => {
    const { userid, message, phoneNumbers } = req.body;

    // Ensure phoneNumbers is always a string or an array
    const phoneNumberList = typeof phoneNumbers === 'string' ? phoneNumbers.split(',') : phoneNumbers;

    // Process phone numbers
    const numbersArray = (phoneNumberList || []).map(number => number.trim() + '@c.us');

    // Retrieve client by userid
    const client = clients[userid];
    if (!client) {
        return res.status(400).json({ status: 'Client not found or not initialized' });
    }

    // Check if a file is uploaded
    const filePath = req.file ? req.file.path : null;
    const fileName = req.file ? req.file.originalname : null;
    const mimeType = req.file ? req.file.mimetype : null;

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

        return res.json({ status: results });
    }

    // Process the file
    fs.readFile(filePath, async (err, data) => {
        if (err) {
            return res.json({ status: `Failed to read file: ${err}` });
        }

        const media = new MessageMedia(mimeType, data.toString('base64'), fileName);

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

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
