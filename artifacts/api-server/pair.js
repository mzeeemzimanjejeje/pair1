const { makeid } = require('./id');
const { setSession, deleteSession } = require('./store');
const express = require('express');
const fs = require('fs');
let router = express.Router();
const pino = require('pino');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers
} = require('@whiskeysockets/baileys');

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get('/', async (req, res) => {
    const id = makeid();
    let num = req.query.number;

    if (!num) {
        return res.json({ code: 'Please provide a phone number' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (event, data) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const tempDir = process.env.VERCEL ? '/tmp' : './temp';

    async function startPairing() {
        const { state, saveCreds } = await useMultiFileAuthState(`${tempDir}/${id}`);
        try {
            const sock = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })),
                },
                printQRInTerminal: false,
                logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
                browser: Browsers.ubuntu('Chrome'),
            });

            setSession(id, { status: 'waiting' });
            sock.ev.on('creds.update', saveCreds);

            sock.ev.on('connection.update', async (s) => {
                const { connection, lastDisconnect } = s;
                if (connection === 'open') {
                    try {
                        await delay(3000);
                        const b64data = Buffer.from(JSON.stringify(state.creds)).toString('base64');
                        const sessionId = 'TRUTH-MD:~' + b64data;
                        setSession(id, { status: 'connected', sessionId });
                        const rawJid = sock.user.id;
                        const jid = rawJid.split(':')[0] + '@s.whatsapp.net';
                        const session = await sock.sendMessage(jid, { text: sessionId });
                        await sock.sendMessage(jid, {
                            text: `╔════════════════════\n║ 🟢 SESSION CONNECTED\n║ ✓ BOT: TRUTH-MD\n║ ✓ TYPE: BASE64\n║ ✓ PREFIX: TRUTH-MD:~\n╚════════════════════`
                        }, { quoted: session });
                        send('session', { sessionId });
                    } catch (e) {
                        send('error', { message: e.message });
                        setSession(id, { status: 'error', error: e.message });
                    }
                    setTimeout(() => { deleteSession(id); }, 300000);
                    await delay(100);
                    res.end();
                    await sock.ws.close();
                    return await removeFile(`${tempDir}/${id}`);
                } else if (connection === 'close' && lastDisconnect?.error?.output?.statusCode !== 401) {
                    await delay(10000);
                    startPairing();
                }
            });

            if (!sock.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                const code = await sock.requestPairingCode(num);
                const formatted = code?.match(/.{1,4}/g)?.join('-') || code;
                send('code', { code: formatted });
            }
        } catch (err) {
            console.log('Pairing error:', err.message || err);
            await removeFile(`${tempDir}/${id}`);
            send('error', { message: 'Service Currently Unavailable' });
            res.end();
        }
    }

    return await startPairing();
});

module.exports = router;
