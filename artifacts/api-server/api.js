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
    code: session.code,
  });
});

router.post('/pair/reset', (req, res) => {
  resetSession();
  res.json({ ok: true });
});

// 1:1 mirror of Courtney250/Techword-bot-pair- pair.js, with TRUTH-MD
// branding and our REST/polling shape instead of SSE. Do NOT change the
// timings, JIDs, send order, or reconnect behaviour — they are exactly
// what makes the upstream repo work end-to-end.
async function startPairing(phoneNumber, existing) {
  const id = existing?.id || makeid(6);
  const dir = existing?.dir || `${tempRoot}/pair_${id}`;
  if (!existing) {
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
    if (connection === 'open' && session.id === id) {
      try {
        await delay(3000);
        const b64data = Buffer.from(JSON.stringify(state.creds)).toString('base64');
        const sessionId = 'TRUTH-MD:~' + b64data;
        session.sessionId = sessionId;
        session.state = 'connected';
        success += 1;

        const sentMsg = await sock.sendMessage(sock.user.id, { text: sessionId });

        const TRUTH_MD_TEXT = `
╔════════════════════
║ 🟢 SESSION CONNECTED ◇
║ ✓ BOT: TRUTH-MD
║ ✓ TYPE: BASE64
║ ✓ OWNER: MZEEEMZIMANJEJEJE
╚════════════════════`;

        await sock.sendMessage(sock.user.id, { text: TRUTH_MD_TEXT }, { quoted: sentMsg });

        await delay(100);
        try { await sock.ws.close(); } catch (_) {}
        rmDir(dir);
      } catch (e) {
        console.log('[pair] post-open error:', e?.message);
      }
    } else if (
      connection === 'close' &&
      session.id === id &&
      lastDisconnect &&
      lastDisconnect.error &&
      lastDisconnect.error.output &&
      lastDisconnect.error.output.statusCode != 401
    ) {
      if (session.state === 'connected') return;
      session.state = 'connecting';
      await delay(10000);
      if (session.id !== id || session.state === 'connected') return;
      try {
        await startPairing(phoneNumber, { id, dir });
      } catch (e) {
        console.log('[pair] reconnect failed:', e?.message);
        session.state = 'expired';
      }
    } else if (connection === 'close' && session.id === id) {
      session.state = 'expired';
    }
  });

  if (!sock.authState.creds.registered) {
    await delay(1500);
    const num = phoneNumber.replace(/[^0-9]/g, '');
    const customCodes = ['TRUTHTEC', 'TRUTHMDX', 'TRUTHMDD'];
    const custom = customCodes[Math.floor(Math.random() * customCodes.length)];
    const code = await sock.requestPairingCode(num, custom);
    const formatted = code.match(/.{1,4}/g)?.join('-') || code;
    session.code = formatted;
    session.state = 'code_ready';
    console.log('[pair] code generated:', formatted);
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
    console.log('[pair] startPairing FAILED:', err?.message, err?.stack);
    failed += 1;
    rmDir(session.dir);
    session = createEmptySession();
    res.status(503).json({ error: 'pairing_failed', message: err?.message || 'Service Currently Unavailable' });
  }
});

module.exports = router;
