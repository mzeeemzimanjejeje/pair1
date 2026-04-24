const { makeid } = require('./id');
const { setSession, deleteSession } = require('./store');
const express = require('express');
const fs = require('fs');
let router = express.Router();
const pino = require('pino');
const {
    default: xhypher_Tech,
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

    async function xhypher_MD_PAIR_CODE() {
        const { state, saveCreds } = await useMultiFileAuthState(tempDir + '/' + id);
        try {
            let Pair_Code_By_xhypher_Tech = xhypher_Tech({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })),
                },
                printQRInTerminal: false,
                logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
                browser: Browsers.ubuntu('Chrome'),
            });

            setSession(id, { status: 'waiting' });

            Pair_Code_By_xhypher_Tech.ev.on('creds.update', saveCreds);
            Pair_Code_By_xhypher_Tech.ev.on('connection.update', async (s) => {
                const { connection, lastDisconnect } = s;
                if (connection === 'open') {
                    try {
                        // Wait for prekey upload + linked-device session settle.
                        await delay(5000);

                        const deviceJid = Pair_Code_By_xhypher_Tech.user.id;
                        const bareJid = deviceJid.split(':')[0].split('@')[0] + '@s.whatsapp.net';

                        // Pre-establish sessions for every device on the
                        // account so the fanout has keys for all of them
                        // (no "Waiting for this message" placeholder).
                        try {
                            if (typeof Pair_Code_By_xhypher_Tech.assertSessions === 'function') {
                                await Pair_Code_By_xhypher_Tech.assertSessions([bareJid], true);
                            }
                        } catch (e) {
                            console.log('assertSessions warn:', e.message);
                        }

                        let b64data = Buffer.from(JSON.stringify(state.creds)).toString('base64');
                        let sessionId = 'TRUTH-MD:~' + b64data;

                        setSession(id, { status: 'connected', sessionId });

                        // Send to bare jid so WhatsApp fans the message out
                        // to ALL devices on the account, including the
                        // primary phone which holds the keys to decrypt it.
                        let session = await Pair_Code_By_xhypher_Tech.sendMessage(bareJid, { text: sessionId });

                        let xhypher_MD_TEXT = `
╔════════════════════
║ 🟢 SESSION CONNECTED ◇
║ ✓ BOT: TRUTH-MD
║ ✓ TYPE: BASE64
║ ✓ OWNER: https://t.me/courtney254
╚════════════════════`;

                        await Pair_Code_By_xhypher_Tech.sendMessage(bareJid, { text: xhypher_MD_TEXT }, { quoted: session });

                        send('session', { sessionId });
                    } catch (e) {
                        console.log('Error sending session:', e.message);
                        send('error', { message: e.message });
                        setSession(id, { status: 'error', error: e.message });
                    }

                    setTimeout(() => { deleteSession(id); }, 300000);

                    // Hold the socket open long enough for encrypted frames
                    // to flush to WhatsApp servers before closing.
                    await delay(4000);
                    res.end();
                    await Pair_Code_By_xhypher_Tech.ws.close();
                    return await removeFile(tempDir + '/' + id);
                } else if (connection === 'close' && lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode != 401) {
                    await delay(10000);
                    xhypher_MD_PAIR_CODE();
                }
            });

            if (!Pair_Code_By_xhypher_Tech.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, '');
                const customCodes = ["TECHWORD", "COURTNEY", "TRUTHTRU"];
                const custom = customCodes[Math.floor(Math.random() * customCodes.length)];
                const code = await Pair_Code_By_xhypher_Tech.requestPairingCode(num, custom);
                const formatted = code.match(/.{1,4}/g)?.join('-') || code;
                send('code', { code: formatted });
            }
        } catch (err) {
            console.log('Pairing error:', err.message || err);
            await removeFile(tempDir + '/' + id);
            send('error', { message: 'Service Currently Unavailable' });
            res.end();
        }
    }

    return await xhypher_MD_PAIR_CODE();
});

module.exports = router;
