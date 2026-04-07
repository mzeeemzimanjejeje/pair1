import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  delay,
  type WASocket,
  type ConnectionState,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { logger } from "./logger";
import path from "path";
import fs from "fs";
import { EventEmitter } from "events";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BotState =
  | "connecting"
  | "qr_ready"
  | "code_ready"
  | "waiting_confirm"
  | "connected"
  | "disconnected";

export const SESSION_PREFIX = "TRUTH-MD:~";

export interface SessionState {
  connected: boolean;
  phone: string | null;
  state: BotState;
  pairingCode: string | null;
  codeIssuedAt: number | null;
  lastError: string | null;
  sessionId: string | null;
}

export function checkRateLimit(_phone: string): { ok: boolean; retryInMs: number } {
  return { ok: true, retryInMs: 0 };
}

// ─── Helper: remove directory ─────────────────────────────────────────────────

function removeDir(p: string) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
}

// ─── Session class ────────────────────────────────────────────────────────────

class BaileysSession extends EventEmitter {
  // The "background" socket — keeps a warm QR-ready connection at all times
  private sock: WASocket | null = null;
  public sessionDir: string;

  public sessionState: SessionState = {
    connected: false,
    phone: null,
    state: "connecting",
    pairingCode: null,
    codeIssuedAt: null,
    lastError: null,
    sessionId: null,
  };

  constructor() {
    super();
    this.sessionDir = path.join(process.cwd(), "auth_info_baileys");
    if (!fs.existsSync(this.sessionDir)) fs.mkdirSync(this.sessionDir, { recursive: true });
  }

  private setState(patch: Partial<SessionState>) {
    this.sessionState = { ...this.sessionState, ...patch };
    this.emit("state-change", this.sessionState);
  }

  private clearAuthDir() {
    try {
      fs.rmSync(this.sessionDir, { recursive: true, force: true });
      fs.mkdirSync(this.sessionDir, { recursive: true });
      logger.info("Auth session cleared");
    } catch (e) { logger.error({ e }, "Failed to clear auth session"); }
  }

  // ── Background socket (keeps server "warm" for status checks) ────────────

  async start() {
    try {
      const { version } = await fetchLatestBaileysVersion();
      const { state: authState, saveCreds } = await useMultiFileAuthState(this.sessionDir);

      let fullyConnected = false;
      const guardedSaveCreds = async () => { if (fullyConnected) await saveCreds(); };

      const silentLogger = logger.child({ level: "silent" }) as any;

      this.sock = makeWASocket({
        version,
        auth: {
          creds: authState.creds,
          keys: makeCacheableSignalKeyStore(authState.keys, silentLogger),
        },
        printQRInTerminal: false,
        logger: silentLogger,
        browser: Browsers.ubuntu("Chrome"),
        generateHighQualityLinkPreview: false,
      });

      this.setState({ state: "connecting", lastError: null });
      logger.info("Background session started");

      this.sock.ev.on("connection.update", async (update: Partial<ConnectionState>) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !this.sessionState.pairingCode) {
          this.setState({ state: "qr_ready" });
        }

        if (connection === "open") {
          fullyConnected = true;
          await saveCreds();
          const phone = this.sock?.user?.id?.split(":")[0] ?? null;
          this.setState({ connected: true, phone, state: "connected", pairingCode: null, codeIssuedAt: null, lastError: null });
          logger.info({ phone }, "WhatsApp linked successfully");
        }

        if (connection === "close") {
          const err = lastDisconnect?.error as Boom | undefined;
          const code = err?.output?.statusCode;
          const isLoggedOut = code === DisconnectReason.loggedOut || code === 401;

          logger.info({ statusCode: code }, "Connection closed");

          if (isLoggedOut || code === 408) {
            fullyConnected = false;
            this.clearAuthDir();
          }

          // If the pairing socket is actively holding a code, don't wipe it
          const hasActiveCode = !!this.sessionState.pairingCode;
          const patch: Partial<SessionState> = {
            connected: false,
            phone: null,
            state: hasActiveCode ? this.sessionState.state : "connecting",
            lastError: null,
          };
          if (!hasActiveCode) {
            patch.pairingCode = null;
            patch.codeIssuedAt = null;
          }
          this.setState(patch);

          if (!isLoggedOut) setTimeout(() => this.start(), 3_000);
        }
      });

      this.sock.ev.on("creds.update", guardedSaveCreds);
      logger.info("Baileys session started");
    } catch (err) {
      logger.error({ err }, "Failed to start session");
      this.setState({ state: "connecting", connected: false, lastError: "Session error. Retrying…" });
      setTimeout(() => this.start(), 5_000);
    }
  }

  // ── One-shot pairing: fresh socket per request ───────────────────────────

  async requestPairingCode(phoneNumber: string): Promise<string> {
    const cleanPhone = phoneNumber.replace(/\D/g, "");
    if (!cleanPhone || cleanPhone.length < 7) {
      throw new Error("Invalid phone number. Include the country code (e.g. 254712345678).");
    }

    const { ok, retryInMs } = checkRateLimit(cleanPhone);
    if (!ok) throw new Error(`Please wait ${Math.ceil(retryInMs / 1000)}s before requesting a new code.`);

    // Fresh, isolated temp dir — credentials are saved here so the 515-reconnect
    // can pick them up and reach connection === "open".
    const pairId = `pair_${Date.now()}`;
    const pairDir = path.join(process.cwd(), "temp", pairId);
    fs.mkdirSync(pairDir, { recursive: true });

    return new Promise<string>(async (resolve, reject) => {
      let codeResolved = false;   // true once we've returned the code to the caller
      let terminated  = false;   // true once we must not create another socket

      const { version } = await fetchLatestBaileysVersion();

      // Clean up temp dir after 10 minutes
      const scheduleCleanup = () => setTimeout(() => removeDir(pairDir), 600_000);

      const terminate = (err?: Error) => {
        if (terminated) return;
        terminated = true;
        scheduleCleanup();
        if (err) reject(err);
      };

      // ── createSocket: (re)connect with whatever creds are in pairDir ──────
      const createSocket = async () => {
        if (terminated) return;

        const { state: authState, saveCreds } = await useMultiFileAuthState(pairDir);
        const silentLogger = logger.child({ level: "silent" }) as any;

        const sock = makeWASocket({
          version,
          auth: {
            creds: authState.creds,
            keys: makeCacheableSignalKeyStore(authState.keys, silentLogger),
          },
          printQRInTerminal: false,
          logger: silentLogger,
          browser: Browsers.ubuntu("Chrome"),
          generateHighQualityLinkPreview: false,
        });

        sock.ev.on("creds.update", saveCreds);

        sock.ev.on("connection.update", async (update: Partial<ConnectionState>) => {
          const { connection, lastDisconnect, qr } = update;

          // ── First QR → request pairing code (only once per session) ──────
          if (qr && !sock.authState.creds.registered && !codeResolved && !terminated) {
            try {
              await delay(1500);
              const raw = await sock.requestPairingCode(cleanPhone);
              const code = raw?.replace(/-/g, "").match(/.{1,4}/g)?.join("-") ?? raw;

              this.setState({
                state: "code_ready",
                pairingCode: code,
                codeIssuedAt: Date.now(),
                lastError: null,
              });

              logger.info({ phone: cleanPhone, code }, "Pairing code issued");
              codeResolved = true;
              resolve(code);
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : "Code request failed";
              logger.error({ e }, "Failed to request pairing code");
              terminate(new Error(msg));
            }
          }

          // ── Connection open → pairing complete, generate session ─────────
          if (connection === "open") {
            let sessionId: string | null = null;
            try {
              await saveCreds();
              const credsJson = JSON.stringify(authState.creds);
              const b64 = Buffer.from(credsJson).toString("base64");
              sessionId = `${SESSION_PREFIX}${b64}`;
            } catch (e) {
              logger.warn({ e }, "Could not encode session ID");
            }

            const phone = sock.user?.id?.split(":")[0] ?? null;
            this.setState({
              connected: true, phone, state: "connected",
              pairingCode: null, codeIssuedAt: null, lastError: null, sessionId,
            });
            logger.info({ phone }, "WhatsApp linked via pairing code! Session ID generated.");

            // Send session string to user's own WhatsApp
            if (sessionId) {
              try {
                await delay(3000);
                const jid = sock.user?.id ?? "";
                await sock.sendMessage(jid, { text: sessionId });
                const msg = `╔════════════════════\n║ 🟢 SESSION CONNECTED\n║ ✓ BOT: TRUTH-MD\n║ ✓ TYPE: BASE64\n║ ✓ PREFIX: TRUTH-MD:~\n║ ✓ SUPPORT: t.me/TruthMD\n╚════════════════════`;
                await sock.sendMessage(jid, { text: msg });
                logger.info({ phone }, "Session ID sent to WhatsApp");
              } catch (e) {
                logger.warn({ e }, "Could not send session to WhatsApp");
              }
            }

            try { sock.ev.removeAllListeners(); sock.ws.close(); } catch {}
            terminate();
          }

          // ── Connection closed ─────────────────────────────────────────────
          if (connection === "close") {
            const err    = lastDisconnect?.error as Boom | undefined;
            const code   = err?.output?.statusCode;
            const isLoggedOut = code === DisconnectReason.loggedOut || code === 401;
            const isTimeout   = code === 408;
            // 515 = WhatsApp "Stream Errored (restart required)" — always fired
            // after the pairing handshake completes; reconnect is mandatory.
            const needsRestart = code === 515;

            logger.info({ statusCode: code }, "Pairing socket closed");

            if (needsRestart) {
              // Normal post-pairing restart — reconnect with saved creds.
              // connection === "open" will fire on the new socket.
              logger.info("515 restart after pairing — reconnecting…");
              try { sock.ev.removeAllListeners(); sock.ws.close(); } catch {}
              await delay(1_000);
              createSocket().catch((e) => terminate(e instanceof Error ? e : new Error(String(e))));
            } else if (isTimeout) {
              terminate(new Error("Pairing timed out. Please try again."));
            } else if (isLoggedOut) {
              terminate(new Error("Logged out during pairing. Please try again."));
            } else if (!terminated) {
              // Any other unexpected close — give up
              terminate(new Error("Connection lost during pairing. Please try again."));
            }
          }
        });
      };

      // Kick off the first socket
      createSocket().catch((e) => terminate(e instanceof Error ? e : new Error(String(e))));
    });
  }

  markCodeEntered() {
    if (this.sessionState.state === "code_ready") {
      this.setState({ state: "waiting_confirm" });
    }
  }

  clearPendingPhone() { /* no-op */ }

  getState(): SessionState { return this.sessionState; }
  getQr(): null { return null; }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let sessionInstance: BaileysSession | null = null;

export function getSession(): BaileysSession {
  if (!sessionInstance) {
    sessionInstance = new BaileysSession();
    sessionInstance.start().catch((err) => {
      logger.error({ err }, "Failed to initialise session");
    });
  }
  return sessionInstance;
}

export { BaileysSession };
