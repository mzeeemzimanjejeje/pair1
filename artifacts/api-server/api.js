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

let session = {
  id: null,
  state: 'disconnected', // connecting | code_ready | waiting_confirm | connected | disconnected
  code: null,
  phone: null,
  sessionId: null,
  sock: null,
  dir: null,
};

function rmDir(p) {
  if (p && fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function resetSession() {
  try { session.sock?.ws?.close(); } catch (_) {}
  rmDir(session.dir);
  session = { id: null, state: 'disconnected', code: null, phone: null, sessionId: null, sock: null, dir: null };
}

router.use((req, res, next) => {
  requests += 1;
  next();
});

router.get('/healthz', (req, res) => {
  res.json({ status: 'ok' });
});

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
  res.status(503).json({ error: 'qr_disabled', message: 'QR pairing is not available; use code pairing instead.' });
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

router.post('/pair/code', async (req, res) => {
  const phoneNumber = (req.body?.phoneNumber || '').toString().replace(/[^0-9]/g, '');
  if (!phoneNumber || phoneNumber.length < 6) {
    failed += 1;
    return res.status(400).json({ error: 'invalid_phone', message: 'Phone number is required (digits only, with country code).' });
  }

  if (session.state === 'connecting' || session.state === 'code_ready' || session.state === 'waiting_confirm') {
    if (session.code && session.phone === phoneNumber) {
      return res.json({ code: session.code, phoneNumber });
    }
    resetSession();
  }

  const id = makeid(6);
  const dir = `${tempRoot}/pair_${id}`;
  session = { id, state: 'connecting', code: null, phone: phoneNumber, sessionId: null, sock: null, dir };

  let responded = false;
  const respond = (status, body) => {
    if (responded) return;
    responded = true;
    res.status(status).json(body);
  };

  try {
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
          await delay(2000);
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
          failed += 1;
          session.state = 'disconnected';
        }
      } else if (connection === 'close') {
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === 401 || session.state === 'connected') {
          // logged out or done — keep state
        } else {
          session.state = 'disconnected';
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
      respond(200, { code: formatted, phoneNumber });
    } else {
      respond(200, { code: session.code || '----', phoneNumber });
    }
  } catch (err) {
    failed += 1;
    rmDir(dir);
    session.state = 'disconnected';
    respond(503, { error: 'pairing_failed', message: err?.message || 'Service Currently Unavailable' });
  }
});

module.exports = router;
