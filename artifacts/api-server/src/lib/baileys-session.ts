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

export interface SessionState {
  connected: boolean;
  phone: string | null;
  state: BotState;
  pairingCode: string | null;
  codeIssuedAt: number | null;
  lastError: string | null;
}

// ─── Rate limiter (30 s between requests per phone) ──────────────────────────

const CODE_COOLDOWN_MS = 30_000;
const lastCodeRequest = new Map<string, number>();

export function checkRateLimit(phone: string): { ok: boolean; retryInMs: number } {
  const last = lastCodeRequest.get(phone) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < CODE_COOLDOWN_MS) return { ok: false, retryInMs: CODE_COOLDOWN_MS - elapsed };
  return { ok: true, retryInMs: 0 };
}

function recordCodeRequest(phone: string) {
  lastCodeRequest.set(phone, Date.now());
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

          let lastError: string | null = null;
          if (isLoggedOut) lastError = "Logged out — please pair again.";
          else if (code === 408) lastError = "Pairing timed out — generate a new code.";

          this.setState({ connected: false, phone: null, state: "connecting", pairingCode: null, codeIssuedAt: null, lastError });

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

    // ── Use a fresh, isolated temp dir so this code gets maximum validity ──
    const pairId = `pair_${Date.now()}`;
    const pairDir = path.join(process.cwd(), "temp", pairId);
    fs.mkdirSync(pairDir, { recursive: true });

    return new Promise<string>(async (resolve, reject) => {
      let finished = false;

      const finish = (err?: Error) => {
        if (finished) return;
        finished = true;
        // Clean up temp dir after 10 minutes
        setTimeout(() => removeDir(pairDir), 600_000);
        if (err) reject(err);
      };

      try {
        const { version } = await fetchLatestBaileysVersion();
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
          browser: Browsers.ubuntu("Chrome"),    // ← must match reference exactly
          generateHighQualityLinkPreview: false,
        });

        sock.ev.on("connection.update", async (update: Partial<ConnectionState>) => {
          const { connection, lastDisconnect, qr } = update;

          // As soon as socket is ready (QR available), request the code
          if (qr && !sock.authState.creds.registered) {
            try {
              await delay(1500); // give WA server time to settle (mirrors reference impl)

              // Custom prefix options — increases code readability  
              const prefixes = ["TRUTHMD", "TRUTH", "TRUTHX"];
              const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];

              const raw = await sock.requestPairingCode(cleanPhone, prefix);
              const code = raw?.replace(/-/g, "").match(/.{1,4}/g)?.join("-") ?? raw;

              recordCodeRequest(cleanPhone);

              this.setState({
                state: "code_ready",
                pairingCode: code,
                codeIssuedAt: Date.now(),
                lastError: null,
              });

              logger.info({ phone: cleanPhone, code }, "Pairing code issued");
              if (!finished) { finished = true; resolve(code); }
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : "Code request failed";
              logger.error({ e }, "Failed to request pairing code");
              finish(new Error(msg));
            }
          }

          if (connection === "open") {
            // User successfully paired — update global state
            const phone = sock.user?.id?.split(":")[0] ?? null;
            this.setState({ connected: true, phone, state: "connected", pairingCode: null, codeIssuedAt: null, lastError: null });
            logger.info({ phone }, "WhatsApp linked via pairing code!");

            // Persist creds to main auth dir so auto-reconnect works
            try {
              const mainAuth = await useMultiFileAuthState(this.sessionDir);
              // Copy over the linked creds
              await mainAuth.saveCreds();
            } catch {}

            try { sock.ev.removeAllListeners(); sock.ws.close(); } catch {}
            finish();
          }

          if (connection === "close") {
            const err = lastDisconnect?.error as Boom | undefined;
            const statusCode = err?.output?.statusCode;
            const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
            const isTimeout = statusCode === 408;

            logger.info({ statusCode }, "Pairing socket closed");

            if (isTimeout) {
              finish(new Error("Pairing timed out. Please try again."));
            } else if (!isLoggedOut && !finished) {
              // Retry after a short wait
              await delay(5_000);
              try { sock.ev.removeAllListeners(); sock.ws.close(); } catch {}
              finish(new Error("Connection lost. Please try again."));
            }
          }
        });

        sock.ev.on("creds.update", saveCreds);

      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to start pairing socket";
        finish(new Error(msg));
      }
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
