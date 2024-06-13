const express = require('express');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');

const app = express();
var port = process.env.PORT || 3000;

const corsOptions = {
  origin: '*', // Allow requests from this origin
  optionsSuccessStatus: 200 // Some legacy browsers (IE11, various SmartTVs) choke on 204
};

// Middleware to enable CORS
app.use(cors(corsOptions));

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

    let clientReady = false; // Flag to track client readiness

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
        // Send response only if the client is ready and response hasn't been sent yet
        if (!clientReady && !res.headersSent) {
            res.status(200).send({ message: `Client ${userid} is ready!` });
            clientReady = true; // Set flag to true indicating response has been sent
        }
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
    if (!userid) {
        return res.status(400).send({ message: 'User ID is missing' });
    }

    console.log(`Received userid: ${userid}`);

    if (!clients[userid]) {
        initializeClient(userid, res);
    } else {
        const client = clients[userid];
        if (client.info && client.info.pushname) {
            return res.status(200).send({ message: 'Client already authenticated' });
        } else {
            initializeClient(userid, res);
        }
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

    const messageDelay = 5000; // 5 seconds delay between messages
    const messageBatchSize = 10; // Send 10 messages before a 30 seconds delay

    // Function to send messages with delays
    async function sendMessagesWithDelay(messages) {
        for (const [index, number] of messages.entries()) {
            try {
                await client.sendMessage(number, message);
                results.push(`${results.length + 1} out of ${numbersArray.length} sent to ${number}`);
            } catch (err) {
                results.push(`Failed to send message to ${number}: ${err}`);
            }

            // If message index is a multiple of messageBatchSize, apply 30 seconds delay
            if ((index + 1) % messageBatchSize === 0) {
                await new Promise(resolve => setTimeout(resolve, 30000)); // 30 seconds delay
            } else {
                await new Promise(resolve => setTimeout(resolve, messageDelay)); // 5 seconds delay between messages
            }
        }
    }

    // If no file is uploaded, handle sending messages without media
    if (!filePath) {
        await sendMessagesWithDelay(numbersArray);
        return res.json({ status: results });
    }

    // Process the file
    fs.readFile(filePath, async (err, data) => {
        if (err) {
            return res.json({ status: `Failed to read file: ${err}` });
        }

        const media = new MessageMedia(mimeType, data.toString('base64'), fileName);
        await sendMessagesWithDelay(numbersArray.map(() => media)); // Use media for each message

        res.json({ status: results });
    });
});


app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
