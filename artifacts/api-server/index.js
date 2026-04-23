const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const __path = __dirname;
const bodyParser = require("body-parser");
const port = process.env.PORT || 5000;
code = require('./pair');
const { getSession } = require('./store');
require('events').EventEmitter.defaultMaxListeners = 500;

const timestampFile = path.join(process.env.VERCEL ? '/tmp' : __path, '.creation_time');
let creationTime;
if (fs.existsSync(timestampFile)) {
    creationTime = parseInt(fs.readFileSync(timestampFile, 'utf8').trim(), 10);
} else {
    creationTime = Date.now();
    try { fs.writeFileSync(timestampFile, String(creationTime)); } catch (_) {}
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use('/code', code);

app.get('/validate', (req, res) => {
    res.sendFile(__path + '/validate.html');
});

app.post('/validate-session', (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId || typeof sessionId !== 'string') {
        return res.json({ valid: false, error: 'No session ID provided' });
    }

    const trimmed = sessionId.trim();
    const prefix = 'TRUTH-MD:~';

    if (!trimmed.startsWith(prefix)) {
        return res.json({ valid: false, error: 'Missing or incorrect prefix. Must start with TRUTH-MD:~' });
    }

    const b64Part = trimmed.slice(prefix.length);
    if (!b64Part || b64Part.length < 10) {
        return res.json({ valid: false, error: 'Session data is too short or empty' });
    }

    try {
        const decoded = Buffer.from(b64Part, 'base64').toString('utf8');
        const creds = JSON.parse(decoded);

        const hasPhoneId = !!(creds.me && creds.me.id);
        const hasKeys = !!(creds.noiseKey || creds.signedIdentityKey || creds.advSecretKey);
        const dataSize = Math.round(b64Part.length / 1024 * 100) / 100 + ' KB';

        return res.json({
            valid: true,
            prefix: 'TRUTH-MD',
            hasPhoneId,
            hasKeys,
            dataSize
        });
    } catch (e) {
        return res.json({ valid: false, error: 'Invalid Base64 or corrupted session data' });
    }
});

app.use('/', async (req, res, next) => {
    if (req.path === '/' || req.path === '/pair') {
        return res.sendFile(__path + '/pair.html');
    }
    next();
});

app.get('/uptime', (req, res) => {
    const uptimeMs = Date.now() - creationTime;
    const seconds = Math.floor(uptimeMs / 1000) % 60;
    const minutes = Math.floor(uptimeMs / 60000) % 60;
    const hours = Math.floor(uptimeMs / 3600000) % 24;
    const days = Math.floor(uptimeMs / 86400000);
    res.json({
        uptime: `${days}d ${hours}h ${minutes}m ${seconds}s`,
        startedAt: new Date(creationTime).toISOString(),
        uptimeMs
    });
});

app.get('/session-status/:id', (req, res) => {
    const result = getSession(req.params.id);
    if (!result) {
        return res.json({ status: 'not_found' });
    }
    res.json(result);
});

if (!process.env.VERCEL) {
    app.listen(port, '0.0.0.0', () => {
        console.log(`📡 Connected on http://0.0.0.0:` + port)
    })
}

module.exports = app
