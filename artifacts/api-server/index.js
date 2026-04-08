const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const __path = __dirname;
const bodyParser = require('body-parser');
const port = process.env.PORT || 5000;
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

let visitors = new Set();
let requestCount = 0;
let successCount = 0;
let failedCount = 0;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use((req, res, next) => {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
    visitors.add(ip);
    requestCount++;
    res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 400) successCount++;
        else failedCount++;
    });
    next();
});

let pairModule = null;
let activePairingState = {
    connected: false,
    phone: null,
    state: 'idle',
    pairingCode: null,
    codeIssuedAt: null,
    lastError: null,
    sessionId: null
};

function getPairModule() {
    if (!pairModule) pairModule = require('./pair');
    return pairModule;
}

app.get('/api/stats', (req, res) => {
    const uptimeMs = Date.now() - creationTime;
    const uptimeSeconds = Math.floor(uptimeMs / 1000);
    res.json({
        uptimeSeconds,
        visitors: visitors.size,
        requests: requestCount,
        success: successCount,
        failed: failedCount
    });
});

app.get('/api/pair/status', (req, res) => {
    res.json(activePairingState);
});

app.post('/api/pair/code', (req, res) => {
    const { phoneNumber } = req.body || {};
    if (!phoneNumber) return res.status(400).json({ error: 'invalid_request', message: 'Phone number required' });

    const cleanPhone = String(phoneNumber).replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length < 7) {
        return res.status(400).json({ error: 'invalid_phone', message: 'Phone number must include country code (e.g. 254712345678)' });
    }

    activePairingState = {
        connected: false,
        phone: cleanPhone,
        state: 'generating',
        pairingCode: null,
        codeIssuedAt: null,
        lastError: null,
        sessionId: null
    };

    const pair = getPairModule();

    const codePromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Timeout waiting for pairing code')), 30000);

        const fakeRes = {
            setHeader: () => {},
            flushHeaders: () => {},
            writeHead: () => {},
            write: (data) => {
                try {
                    const lines = String(data).split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const parsed = JSON.parse(line.slice(6));
                            if (parsed.code) {
                                activePairingState.pairingCode = parsed.code;
                                activePairingState.codeIssuedAt = Date.now();
                                activePairingState.state = 'code_ready';
                                clearTimeout(timeout);
                                resolve(parsed.code);
                            }
                            if (parsed.sessionId) {
                                activePairingState.sessionId = parsed.sessionId;
                                activePairingState.connected = true;
                                activePairingState.state = 'connected';
                            }
                            if (parsed.message && !parsed.code && !parsed.sessionId) {
                                activePairingState.lastError = parsed.message;
                                activePairingState.state = 'error';
                                clearTimeout(timeout);
                                reject(new Error(parsed.message));
                            }
                        }
                    }
                } catch (_) {}
            },
            end: () => {},
            on: () => fakeRes,
            once: () => fakeRes,
            emit: () => {},
            flush: () => {},
            headersSent: false,
            socket: req.socket
        };

        const fakeReq = {
            method: 'GET',
            url: `/?number=${encodeURIComponent(cleanPhone)}`,
            path: '/',
            baseUrl: '',
            originalUrl: `/?number=${encodeURIComponent(cleanPhone)}`,
            query: { number: cleanPhone },
            params: {},
            headers: req.headers,
            socket: req.socket,
            connection: req.connection,
            on: () => fakeReq,
            once: () => fakeReq
        };

        try {
            pair(fakeReq, fakeRes, () => {});
        } catch (err) {
            clearTimeout(timeout);
            reject(err);
        }
    });

    codePromise
        .then(code => {
            res.json({ code, phoneNumber: cleanPhone });
        })
        .catch(err => {
            activePairingState.lastError = err.message;
            activePairingState.state = 'error';
            res.status(503).json({ error: 'pairing_failed', message: err.message });
        });
});

app.post('/api/pair/reset', (req, res) => {
    activePairingState = {
        connected: false, phone: null, state: 'idle',
        pairingCode: null, codeIssuedAt: null, lastError: null, sessionId: null
    };
    res.json({ message: 'Session reset' });
});

app.post('/api/pair/entered', (req, res) => {
    activePairingState.state = 'waiting_confirm';
    res.json({ message: 'Waiting for WhatsApp confirmation' });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.use('/code', (req, res, next) => {
    const pair = getPairModule();
    pair(req, res, next);
});

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
        return res.json({ valid: true, prefix: 'TRUTH-MD', hasPhoneId, hasKeys, dataSize });
    } catch (e) {
        return res.json({ valid: false, error: 'Invalid Base64 or corrupted session data' });
    }
});

app.get('/uptime', (req, res) => {
    const uptimeMs = Date.now() - creationTime;
    const seconds = Math.floor(uptimeMs / 1000) % 60;
    const minutes = Math.floor(uptimeMs / 60000) % 60;
    const hours = Math.floor(uptimeMs / 3600000) % 24;
    const days = Math.floor(uptimeMs / 86400000);
    res.json({ uptime: `${days}d ${hours}h ${minutes}m ${seconds}s`, startedAt: new Date(creationTime).toISOString(), uptimeMs });
});

app.get('/session-status/:id', (req, res) => {
    const result = getSession(req.params.id);
    if (!result) return res.json({ status: 'not_found' });
    res.json(result);
});

const publicDir = path.join(__path, 'public');
const publicIndex = path.join(publicDir, 'index.html');
const hasReactBuild = fs.existsSync(publicDir) && fs.existsSync(publicIndex);
console.log('Public dir:', publicDir, 'exists:', hasReactBuild);

if (hasReactBuild) {
    app.use(express.static(publicDir));
}

app.get('*', (req, res) => {
    const skip = ['/api', '/code', '/validate', '/uptime', '/session-status'];
    if (skip.some(p => req.path.startsWith(p))) return res.status(404).json({ error: 'not_found' });

    if (hasReactBuild) {
        try { return res.sendFile(publicIndex); } catch (_) {}
    }
    try {
        return res.sendFile(path.join(__path, 'pair.html'));
    } catch (_) {
        return res.status(200).send('<html><body><h2>TRUTH-MD Pairing Server Running</h2></body></html>');
    }
});

app.use((err, req, res, next) => {
    console.error('Express error:', err.message || err);
    res.status(500).json({ error: 'internal_error', message: err.message || 'Unknown error' });
});

if (!process.env.VERCEL) {
    app.listen(port, '0.0.0.0', () => console.log(`Server running on http://0.0.0.0:${port}`));
}

module.exports = app;
