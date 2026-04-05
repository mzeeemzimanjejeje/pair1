import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
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
  | "connecting"       // Starting up / reconnecting
  | "qr_ready"         // QR available (fallback)
  | "code_ready"       // Pairing code issued, waiting for user to enter it
  | "waiting_confirm"  // Code entered (countdown done), waiting for WhatsApp ack
  | "connected"        // Fully linked
  | "disconnected";    // Terminal / logged out

export interface SessionState {
  connected: boolean;
  phone: string | null;
  state: BotState;
  pairingCode: string | null;
  codeIssuedAt: number | null;
  lastError: string | null;
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

const CODE_COOLDOWN_MS = 30_000; // 30 s between requests for the same number
const lastCodeRequest = new Map<string, number>();

export function checkRateLimit(phone: string): { ok: boolean; retryInMs: number } {
  const last = lastCodeRequest.get(phone) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < CODE_COOLDOWN_MS) {
    return { ok: false, retryInMs: CODE_COOLDOWN_MS - elapsed };
  }
  return { ok: true, retryInMs: 0 };
}

function recordCodeRequest(phone: string) {
  lastCodeRequest.set(phone, Date.now());
}

// ─── Session class ────────────────────────────────────────────────────────────

class BaileysSession extends EventEmitter {
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
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private setState(patch: Partial<SessionState>) {
    this.sessionState = { ...this.sessionState, ...patch };
    this.emit("state-change", this.sessionState);
  }

  private clearAuthDir() {
    try {
      fs.rmSync(this.sessionDir, { recursive: true, force: true });
      fs.mkdirSync(this.sessionDir, { recursive: true });
      logger.info("Auth session cleared for fresh pairing");
    } catch (e) {
      logger.error({ e }, "Failed to clear auth session");
    }
  }

  // ── Core start ───────────────────────────────────────────────────────────

  async start() {
    try {
      const { version } = await fetchLatestBaileysVersion();
      logger.info({ version }, "Using Baileys version");

      const { state: authState, saveCreds } = await useMultiFileAuthState(
        this.sessionDir,
      );

      // Guard: only persist credentials after a real connection open
      let fullyConnected = false;
      const guardedSaveCreds = async () => {
        if (fullyConnected) await saveCreds();
      };

      this.sock = makeWASocket({
        version,
        auth: authState,
        printQRInTerminal: false,
        logger: logger.child({ level: "silent" }) as any,
        browser: ["TRUTH-MD:~", "Chrome", "1.0.0"],
        generateHighQualityLinkPreview: false,
        // Keep the socket alive longer so the code stays valid
        keepAliveIntervalMs: 10_000,
      });

      this.setState({ state: "connecting", lastError: null });
      logger.info("Baileys session started");

      this.sock.ev.on(
        "connection.update",
        async (update: Partial<ConnectionState>) => {
          const { connection, lastDisconnect, qr } = update;

          // QR received – only surface it if we haven't issued a pairing code yet
          if (qr && !this.sessionState.pairingCode) {
            logger.info("QR code generated");
            this.setState({ state: "qr_ready" });
          }

          if (connection === "connecting") {
            this.setState({ state: "connecting" });
          }

          if (connection === "open") {
            fullyConnected = true;
            await saveCreds();

            const phone = this.sock?.user?.id?.split(":")[0] ?? null;
            this.setState({
              connected: true,
              phone,
              state: "connected",
              pairingCode: null,
              codeIssuedAt: null,
              lastError: null,
            });
            logger.info({ phone }, "WhatsApp linked successfully");
          }

          if (connection === "close") {
            const err = lastDisconnect?.error as Boom | undefined;
            const statusCode = err?.output?.statusCode;
            const isLoggedOut =
              statusCode === DisconnectReason.loggedOut || statusCode === 401;
            const isQrTimeout = statusCode === 408;

            logger.info({ statusCode, isLoggedOut }, "Connection closed");

            // Categorise the error for the UI
            let lastError: string | null = null;
            if (isLoggedOut) {
              lastError = "Logged out by WhatsApp. Please pair again.";
            } else if (isQrTimeout) {
              lastError = "Pairing timed out. Please generate a new code.";
            } else if (statusCode === 503 || statusCode === 500) {
              lastError = "WhatsApp server error. Retrying…";
            } else if (!navigator || statusCode === undefined) {
              // node context – network drop
              lastError = "Network error. Reconnecting…";
            }

            // Wipe stale credentials on logout or QR timeout
            if (isLoggedOut || isQrTimeout) {
              fullyConnected = false;
              this.clearAuthDir();
            }

            this.setState({
              connected: false,
              phone: null,
              state: isLoggedOut ? "disconnected" : "connecting",
              pairingCode: null,
              codeIssuedAt: null,
              lastError,
            });

            // Always reconnect unless deliberately logged out
            if (!isLoggedOut) {
              const delay = isQrTimeout ? 2_000 : 5_000;
              setTimeout(() => this.start(), delay);
            }
          }
        },
      );

      this.sock.ev.on("creds.update", guardedSaveCreds);
    } catch (err) {
      logger.error({ err }, "Failed to start Baileys session");
      this.setState({
        state: "connecting",
        connected: false,
        lastError: "Internal error starting session. Retrying…",
      });
      setTimeout(() => this.start(), 5_000);
    }
  }

  // ── Pairing code request ─────────────────────────────────────────────────

  async requestPairingCode(phoneNumber: string): Promise<string> {
    if (!this.sock) {
      throw new Error("Socket not ready. Please wait a moment and try again.");
    }

    if (this.sessionState.connected) {
      throw new Error("Already connected — no pairing needed.");
    }

    const cleanPhone = phoneNumber.replace(/\D/g, "");
    if (!cleanPhone || cleanPhone.length < 7) {
      throw new Error("Invalid phone number. Include the country code (e.g. 254712345678).");
    }

    // Server-side rate limit
    const { ok, retryInMs } = checkRateLimit(cleanPhone);
    if (!ok) {
      const seconds = Math.ceil(retryInMs / 1000);
      throw new Error(`Please wait ${seconds}s before requesting a new code.`);
    }

    const raw = await this.sock.requestPairingCode(cleanPhone);
    // Ensure XXXX-XXXX format
    const code = raw?.replace(/-/g, "").match(/.{1,4}/g)?.join("-") ?? raw;

    recordCodeRequest(cleanPhone);

    this.setState({
      state: "code_ready",
      pairingCode: code,
      codeIssuedAt: Date.now(),
      lastError: null,
    });

    logger.info({ phone: cleanPhone, code }, "Pairing code issued");
    return code;
  }

  // Mark code as entered (frontend calls this to transition to waiting_confirm)
  markCodeEntered() {
    if (this.sessionState.state === "code_ready") {
      this.setState({ state: "waiting_confirm" });
    }
  }

  // ── Accessors ────────────────────────────────────────────────────────────

  clearPendingPhone() { /* no-op: kept for route compatibility */ }

  getState(): SessionState {
    return this.sessionState;
  }

  // Kept for route compatibility (QR fallback)
  getQr(): null {
    return null;
  }
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
