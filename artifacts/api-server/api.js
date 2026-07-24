const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
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

const tempRoot = (process.env.VERCEL || process.env.DYNO) ? '/tmp' : './temp';
const startedAt = Date.now();
let visitors = 0;
let requests = 0;
let success = 0;
let failed = 0;

// ─── Per-visitor session store ───────────────────────────────────────────────
//
// Each browser tab is assigned a unique random `pairClientId` cookie on its
// first request.  Sessions are stored in this Map keyed by that cookie value.
// Nothing is ever stored in a module-level singleton, so no two visitors can
// ever share state.

const sessions = new Map();

function createEmptySession() {
  return {
    id: null,
    state: 'disconnected',
    code: null,
    phone: null,
    sessionId: null,
    sock: null,
    dir: null,
    lastActivity: Date.now(),
  };
}

/**
 * Read the `pairClientId` cookie from the request.
 * If absent or malformed, generate a fresh one and set it in the response.
 * Returns the clientId string.
 */
function getOrCreateClientId(req, res) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/(?:^|;\s*)pairClientId=([a-f0-9]{32})/);
  if (match) return match[1];

  const clientId = crypto.randomBytes(16).toString('hex');
  // HttpOnly: JS cannot read it → no XSS risk.
  // SameSite=Lax: sent on same-origin navigations and fetch calls.
  // Max-Age=7200: 2-hour window; plenty for a pairing session.
  res.setHeader(
    'Set-Cookie',
    `pairClientId=${clientId}; Path=/; HttpOnly; Max-Age=7200; SameSite=Lax`,
  );
  return clientId;
}

/** Return the session for this visitor, creating an empty one if needed. */
function getClientSession(clientId) {
  if (!sessions.has(clientId)) {
    sessions.set(clientId, createEmptySession());
  }
  const s = sessions.get(clientId);
  s.lastActivity = Date.now();
  return s;
}

function rmDir(p) {
  if (p && fs.existsSync(p)) {
    try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {}
  }
}

/** Close the socket + wipe the auth dir for this visitor's session. */
function resetClientSession(clientId) {
  const s = sessions.get(clientId);
  if (s) {
    try { s.sock?.ws?.close(); } catch (_) {}
    rmDir(s.dir);
  }
  sessions.set(clientId, createEmptySession());
}

// Garbage-collect sessions idle for more than 2 hours every 5 minutes.
setInterval(() => {
  const cutoff = Date.now() - 7200000;
  for (const [cid, s] of sessions) {
    if ((s.lastActivity || 0) < cutoff) {
      try { s.sock?.ws?.close(); } catch (_) {}
      rmDir(s.dir);
      sessions.delete(cid);
    }
  }
}, 300000);

// ─── Middleware ──────────────────────────────────────────────────────────────

router.use((req, res, next) => {
  requests += 1;
  next();
});

// ─── Health / stats ──────────────────────────────────────────────────────────

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

// ─── QR (disabled) ───────────────────────────────────────────────────────────

router.get('/pair/qr', (req, res) => {
  res.status(503).json({ error: 'qr_disabled', message: 'QR pairing disabled; use code pairing.' });
});

// ─── Per-visitor status ──────────────────────────────────────────────────────

router.get('/pair/status', (req, res) => {
  visitors += 1;
  const clientId = getOrCreateClientId(req, res);
  const s = getClientSession(clientId);
  res.json({
    connected: s.state === 'connected',
    phone: s.phone,
    state: s.state,
    sessionId: s.sessionId,
    code: s.code,
  });
});

// ─── Per-visitor reset ───────────────────────────────────────────────────────

router.post('/pair/reset', (req, res) => {
  const clientId = getOrCreateClientId(req, res);
  resetClientSession(clientId);
  res.json({ ok: true });
});

// ─── Pairing logic ───────────────────────────────────────────────────────────

// 1:1 mirror of Courtney250/Techword-bot-pair- pair.js, with TRUTH-MD
// branding and our REST/polling shape instead of SSE. Do NOT change the
// timings, JIDs, send order, or reconnect behaviour — they are exactly
// what makes the upstream repo work end-to-end.
async function startPairing(clientId, phoneNumber, existing) {
  const clientSession = getClientSession(clientId);
  const id = existing?.id || makeid(6);
  const dir = existing?.dir || `${tempRoot}/pair_${id}`;

  if (!existing) {
    Object.assign(clientSession, {
      id,
      state: 'connecting',
      phone: phoneNumber,
      dir,
    });
  }

  const { state, saveCreds } = await useMultiFileAuthState(dir);

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'fatal' }).child({ level: 'fatal' })),
    },
    printQRInTerminal: false,
    logger: pino({ level: 'fatal' }).child({ level: 'fatal' }),
    browser: Browsers.macOS('Safari'),
  });
  clientSession.sock = sock;

  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (s) => {
    // Always re-read from the map so we see the latest state.
    const current = getClientSession(clientId);
    const { connection, lastDisconnect } = s;

    if (connection === 'open' && current.id === id) {
      try {
        // Give Baileys time to upload prekeys and settle the linked-device
        // session before we try to send. Then send to the BARE jid (no
        // device tag) so WhatsApp fans the message out to every device on
        // the account — the primary phone has the keys to decrypt it,
        // which is what eliminates "Waiting for this message".
        await delay(5000);

        const deviceJid = sock.user.id;
        const bareJid = deviceJid.split(':')[0].split('@')[0] + '@s.whatsapp.net';

        // Pre-establish sessions for every device on the account so the
        // outgoing fanout has keys for all of them (no placeholder).
        try {
          if (typeof sock.assertSessions === 'function') {
            await sock.assertSessions([bareJid], true);
          }
        } catch (e) {
          console.log('[pair] assertSessions warn:', e?.message);
        }

        const b64data = Buffer.from(JSON.stringify(state.creds)).toString('base64');
        const sessionId = 'TRUTH-MD:~' + b64data;
        current.sessionId = sessionId;
        current.state = 'connected';
        success += 1;

        const sentMsg = await sock.sendMessage(bareJid, { text: sessionId });

        const TRUTH_MD_TEXT = `
╔════════════════════
║ 🟢 SESSION CONNECTED ◇
║ ✓ BOT: TRUTH-MD
║ ✓ TYPE: BASE64
║ ✓ OWNER: https://t.me/courtney254
║ ✓ CHANNEL: https://t.me/sensation254
╚════════════════════`;

        await sock.sendMessage(bareJid, { text: TRUTH_MD_TEXT }, { quoted: sentMsg });

        // Keep the socket alive long enough for the encrypted frames to
        // actually flush to WhatsApp servers before we close.
        await delay(4000);
        try { await sock.ws.close(); } catch (_) {}
        rmDir(dir);
      } catch (e) {
        console.log('[pair] post-open error:', e?.message);
      }
    } else if (
      connection === 'close' &&
      current.id === id &&
      lastDisconnect &&
      lastDisconnect.error &&
      lastDisconnect.error.output &&
      lastDisconnect.error.output.statusCode != 401
    ) {
      if (current.state === 'connected') return;
      current.state = 'connecting';
      await delay(10000);
      // Re-check after the delay — another request may have reset the session.
      const fresh = getClientSession(clientId);
      if (fresh.id !== id || fresh.state === 'connected') return;
      try {
        await startPairing(clientId, phoneNumber, { id, dir });
      } catch (e) {
        console.log('[pair] reconnect failed:', e?.message);
        getClientSession(clientId).state = 'expired';
      }
    } else if (connection === 'close' && current.id === id) {
      current.state = 'expired';
    }
  });

  if (!sock.authState.creds.registered) {
    await delay(1500);
    const num = phoneNumber.replace(/[^0-9]/g, '');
    const customCodes = ['TRUTHTEC', 'TRUTHMDX', 'TRUTHMDD'];
    const custom = customCodes[Math.floor(Math.random() * customCodes.length)];
    const code = await sock.requestPairingCode(num, custom);
    const formatted = code.match(/.{1,4}/g)?.join('-') || code;
    clientSession.code = formatted;
    clientSession.state = 'code_ready';
    console.log('[pair] code generated:', formatted);
    return formatted;
  }
  return clientSession.code || '----';
}

router.post('/pair/code', async (req, res) => {
  const clientId = getOrCreateClientId(req, res);
  const clientSession = getClientSession(clientId);

  const phoneNumber = (req.body?.phoneNumber || '').toString().replace(/[^0-9]/g, '');
  if (!phoneNumber || phoneNumber.length < 6) {
    failed += 1;
    return res.status(400).json({
      error: 'invalid_phone',
      message: 'Phone number is required (digits only, with country code).',
    });
  }

  // Return cached code for the same phone if still in code_ready state.
  if (
    clientSession.phone === phoneNumber &&
    clientSession.code &&
    clientSession.state === 'code_ready'
  ) {
    return res.json({ code: clientSession.code, phoneNumber });
  }

  // Reset this visitor's session before starting a fresh pairing attempt.
  if (clientSession.state !== 'disconnected') resetClientSession(clientId);

  try {
    const code = await startPairing(clientId, phoneNumber);
    res.json({ code, phoneNumber });
  } catch (err) {
    console.log('[pair] startPairing FAILED:', err?.message, err?.stack);
    failed += 1;
    const staleSession = sessions.get(clientId);
    if (staleSession) rmDir(staleSession.dir);
    sessions.set(clientId, createEmptySession());
    res.status(503).json({
      error: 'pairing_failed',
      message: err?.message || 'Service Currently Unavailable',
    });
  }
});

module.exports = router;
