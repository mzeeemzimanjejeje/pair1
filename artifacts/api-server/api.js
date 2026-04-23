const express = require('express');
const fs = require('fs');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
} = require('@whiskeysockets/baileys');
const { makeid } = require('./id');

const router = express.Router();

const tempRoot = process.env.VERCEL ? '/tmp' : './temp';
const startedAt = Date.now();
let visitors = 0;
let requests = 0;
let success = 0;
let failed = 0;

let session = createEmptySession();

function createEmptySession() {
  return {
    id: null,
    state: 'disconnected',
    code: null,
    phone: null,
    sessionId: null,
    sock: null,
    dir: null,
  };
}

function rmDir(p) {
  if (p && fs.existsSync(p)) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {}
  }
}

function resetSession() {
  try { session.sock?.ws?.close(); } catch (_) {}
  rmDir(session.dir);
  session = createEmptySession();
}

router.use((req, res, next) => {
  requests += 1;
  next();
});

router.get('/healthz', (req, res) => res.json({ status: 'ok' }));

router.get('/stats', (req, res) => {
  res.json({
    status: 'online',
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    visitors,
    requests,
    success,
    failed,
  });
});

router.get('/pair/qr', (req, res) => {
  res.status(503).json({ error: 'qr_disabled', message: 'QR pairing disabled; use code pairing.' });
});

router.get('/pair/status', (req, res) => {
  visitors += 1;
  res.json({
    connected: session.state === 'connected',
    phone: session.phone,
    state: session.state,
    sessionId: session.sessionId,
  });
});

router.post('/pair/reset', (req, res) => {
  resetSession();
  res.json({ ok: true });
});

// Mirrors Techword-bot-pair- pair.js exactly: on close (non-401),
// retry the whole socket so the user's code entry can still be received.
async function startPairing(phoneNumber, existingId) {
  const id = existingId || makeid(6);
  const dir = `${tempRoot}/pair_${id}`;
  if (!existingId) {
    session = { ...createEmptySession(), id, state: 'connecting', phone: phoneNumber, dir };
  }

  const { state, saveCreds } = await useMultiFileAuthState(dir);

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })),
    },
    printQRInTerminal: false,
    logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
    browser: Browsers.ubuntu('Chrome'),
  });
  session.sock = sock;

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (s) => {
    const { connection, lastDisconnect } = s;
    if (connection === 'open') {
      try {
        await delay(3000);
        const b64 = Buffer.from(JSON.stringify(state.creds)).toString('base64');
        const sessionId = 'TRUTH-MD:~' + b64;
        session.sessionId = sessionId;
        session.state = 'connected';
        success += 1;

        try {
          const sent = await sock.sendMessage(sock.user.id, { text: sessionId });
          const banner = `\n╔════════════════════\n║ 🟢 SESSION CONNECTED ◇\n║ ✓ BOT: TRUTH-MD\n║ ✓ TYPE: BASE64\n╚════════════════════`;
          await sock.sendMessage(sock.user.id, { text: banner }, { quoted: sent });
        } catch (e) {
          console.log('WhatsApp notify failed:', e?.message);
        }

        // Cleanup like pair.js — keep session info in memory for status polling,
        // but close the socket and remove the temp creds dir.
        await delay(500);
        try { sock.ws.close(); } catch (_) {}
        rmDir(dir);
      } catch (e) {
        console.log('Post-open error:', e?.message);
      }
    } else if (
      connection === 'close' &&
      lastDisconnect?.error?.output?.statusCode !== 401 &&
      session.state !== 'connected' &&
      session.id === id
    ) {
      // Reconnect like pair.js does: gives the user a working socket
      // when WhatsApp drops the connection mid-pairing.
      console.log('Connection dropped, reconnecting in 10s…');
      await delay(10000);
      if (session.id === id && session.state !== 'connected') {
        try { await startPairing(phoneNumber, id); } catch (e) {
          console.log('Reconnect failed:', e?.message);
          session.state = 'disconnected';
        }
      }
    }
  });

  if (!sock.authState.creds.registered) {
    await delay(1500);
    const customCodes = ['TRUTHTEC', 'TRUTHMDX', 'TRUTHMDD'];
    const custom = customCodes[Math.floor(Math.random() * customCodes.length)];
    const code = await sock.requestPairingCode(phoneNumber, custom);
    const formatted = code.match(/.{1,4}/g)?.join('-') || code;
    session.code = formatted;
    session.state = 'code_ready';
    return formatted;
  }
  return session.code || '----';
}

router.post('/pair/code', async (req, res) => {
  const phoneNumber = (req.body?.phoneNumber || '').toString().replace(/[^0-9]/g, '');
  if (!phoneNumber || phoneNumber.length < 6) {
    failed += 1;
    return res.status(400).json({ error: 'invalid_phone', message: 'Phone number is required (digits only, with country code).' });
  }

  if (session.phone === phoneNumber && session.code && session.state === 'code_ready') {
    return res.json({ code: session.code, phoneNumber });
  }

  if (session.state !== 'disconnected') resetSession();

  try {
    const code = await startPairing(phoneNumber);
    res.json({ code, phoneNumber });
  } catch (err) {
    failed += 1;
    rmDir(session.dir);
    session = createEmptySession();
    res.status(503).json({ error: 'pairing_failed', message: err?.message || 'Service Currently Unavailable' });
  }
});

module.exports = router;
