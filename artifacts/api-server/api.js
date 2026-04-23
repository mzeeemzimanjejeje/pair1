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

// Single global pairing flow. Mirrors Techword pair.js logic, but also
// surfaces refreshed pairing codes to the UI via /api/pair/status.
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
        // Mark connected immediately so the React UI shows success right away
        const b64 = Buffer.from(JSON.stringify(state.creds)).toString('base64');
        const sessionId = 'TRUTH-MD:~' + b64;
        session.sessionId = sessionId;
        session.state = 'connected';
        success += 1;
        console.log('[pair] connected; preparing WhatsApp notify');

        // Normalize JID to s.whatsapp.net format so the message routes
        // through the regular E2E pipeline (avoids "Waiting for this message")
        const rawJid = sock.user?.id || '';
        const phoneOnly = rawJid.split(':')[0].split('@')[0];
        const targetJid = phoneOnly + '@s.whatsapp.net';

        // Wait for the encryption session to settle before sending. Without
        // this, WhatsApp shows "Waiting for this message" because the
        // device hasn't received the prekeys yet.
        await delay(8000);

        try {
          // Tell WhatsApp we're online — primes the message pipeline
          try { await sock.sendPresenceUpdate('available', targetJid); } catch (_) {}

          const sent = await sock.sendMessage(targetJid, { text: sessionId });
          const banner = `\n╔════════════════════\n║ 🟢 SESSION CONNECTED ◇\n║ ✓ BOT: TRUTH-MD\n║ ✓ TYPE: BASE64\n╚════════════════════`;
          await sock.sendMessage(targetJid, { text: banner }, { quoted: sent });
          console.log('[pair] WhatsApp notify sent to', targetJid);
        } catch (e) {
          console.log('[pair] WhatsApp notify FAILED:', e?.message);
        }

        // Keep the socket alive a little longer so WA finishes processing
        await delay(2000);
        try { sock.ws.close(); } catch (_) {}
        rmDir(dir);
      } catch (e) {
        console.log('[pair] post-open error:', e?.message);
      }
    } else if (connection === 'close' && session.id === id) {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log('[pair] connection closed, status:', statusCode);
      if (session.state === 'connected') return; // happy path
      if (statusCode === 401) {
        session.state = 'expired';
        return;
      }
      // WebSocket dropped before user paired (commonly 408 timeout from
      // WhatsApp). Reconnect with the SAME auth dir, regenerate the code,
      // and write it to session.code so the UI's status poll picks it up.
      console.log('[pair] reconnecting in 3s with fresh code…');
      session.state = 'connecting';
      await delay(3000);
      if (session.id !== id || session.state === 'connected') return;
      try {
        await startPairing(phoneNumber, { id, dir });
      } catch (e) {
        console.log('[pair] reconnect failed:', e?.message);
        session.state = 'expired';
      }
    }
  });

  // Brief warmup so Baileys' WebSocket has time to handshake
  await delay(1500);

  if (!sock.authState.creds.registered) {
    let code;
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const customCodes = ['TRUTHTEC', 'TRUTHMDX', 'TRUTHMDD'];
        const custom = customCodes[Math.floor(Math.random() * customCodes.length)];
        code = await sock.requestPairingCode(phoneNumber, custom);
        break;
      } catch (e) {
        lastErr = e;
        console.log(`[pair] requestPairingCode attempt ${attempt} failed:`, e?.message);
        await delay(1000 * attempt);
      }
    }
    if (!code) throw lastErr || new Error('Failed to obtain pairing code');
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
