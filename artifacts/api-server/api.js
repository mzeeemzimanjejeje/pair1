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
    creds: null,
    saveCreds: null,
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

async function startPairing(phoneNumber) {
  const id = makeid(6);
  const dir = `${tempRoot}/pair_${id}`;
  session = { ...createEmptySession(), id, state: 'connecting', phone: phoneNumber, dir };

  const { state, saveCreds } = await useMultiFileAuthState(dir);
  session.creds = state.creds;
  session.saveCreds = saveCreds;

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
        await delay(800);
        const b64 = Buffer.from(JSON.stringify(state.creds)).toString('base64');
        const sessionId = 'TRUTH-MD:~' + b64;
        session.sessionId = sessionId;
        session.state = 'connected';
        success += 1;

        try {
          const sent = await sock.sendMessage(sock.user.id, { text: sessionId });
          const banner = `\n╔════════════════════\n║ 🟢 SESSION CONNECTED ◇\n║ ✓ BOT: TRUTH-MD\n║ ✓ TYPE: BASE64\n╚════════════════════`;
          await sock.sendMessage(sock.user.id, { text: banner }, { quoted: sent });
        } catch (_) {}
      } catch (e) {
        // keep state as-is; status will reflect what we know
      }
    } else if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode === 401) {
        // logged out — clear
        session.state = 'disconnected';
      }
      // For other close events while waiting for user to enter code,
      // keep state at 'code_ready' so the UI keeps polling without confusion.
    }
  });

  // Request the pairing code immediately (no warmup delay)
  if (!sock.authState.creds.registered) {
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

  // If a code is already live for this phone, return it
  if (session.phone === phoneNumber && session.code && session.state === 'code_ready') {
    return res.json({ code: session.code, phoneNumber });
  }

  // Otherwise reset and start fresh
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
