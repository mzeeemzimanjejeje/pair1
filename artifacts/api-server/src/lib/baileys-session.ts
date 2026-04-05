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
import QRCode from "qrcode";
import { EventEmitter } from "events";

export type BotState =
  | "connecting"
  | "connected"
  | "disconnected"
  | "qr_ready"
  | "code_ready";

export interface SessionState {
  connected: boolean;
  phone: string | null;
  state: BotState;
  qr: string | null;
  qrExpiry: number | null;
  pairingCode: string | null;
  codeIssuedAt: number | null;
}

class BaileysSession extends EventEmitter {
  private sock: WASocket | null = null;
  public sessionDir: string;
  // Phone number the user requested pairing for — kept across socket restarts
  private pendingPhone: string | null = null;
  private autoRenewTimer: NodeJS.Timeout | null = null;

  public sessionState: SessionState = {
    connected: false,
    phone: null,
    state: "disconnected",
    qr: null,
    qrExpiry: null,
    pairingCode: null,
    codeIssuedAt: null,
  };

  constructor() {
    super();
    this.sessionDir = path.join(process.cwd(), "auth_info_baileys");
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  private clearAuthDir() {
    try {
      fs.rmSync(this.sessionDir, { recursive: true, force: true });
      fs.mkdirSync(this.sessionDir, { recursive: true });
      logger.info("Cleared auth session for fresh pairing");
    } catch (e) {
      logger.error({ e }, "Failed to clear auth session");
    }
  }

  private cancelAutoRenew() {
    if (this.autoRenewTimer) {
      clearTimeout(this.autoRenewTimer);
      this.autoRenewTimer = null;
    }
  }

  // Called automatically each time a fresh QR is available and pendingPhone is set
  private scheduleAutoRenew(delayMs = 800) {
    this.cancelAutoRenew();
    if (!this.pendingPhone) return;
    const phone = this.pendingPhone;
    this.autoRenewTimer = setTimeout(async () => {
      if (!this.sock || !this.pendingPhone) return;
      try {
        logger.info({ phone }, "Auto-renewing pairing code");
        const code = await this.sock.requestPairingCode(phone);
        const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;
        this.sessionState = {
          ...this.sessionState,
          state: "code_ready",
          pairingCode: formattedCode,
          codeIssuedAt: Date.now(),
          qr: null,
        };
        this.emit("state-change", this.sessionState);
        logger.info({ phone, code: formattedCode }, "Pairing code renewed");
      } catch (err) {
        logger.error({ err }, "Auto-renew pairing code failed");
      }
    }, delayMs);
  }

  async start() {
    try {
      const { version } = await fetchLatestBaileysVersion();
      logger.info({ version }, "Using Baileys version");

      const { state: authState, saveCreds } = await useMultiFileAuthState(
        this.sessionDir,
      );

      // Only persist credentials once fully connected — not during pairing phase
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
      });

      this.sock.ev.on("connection.update", async (update: Partial<ConnectionState>) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          logger.info("QR code generated");

          if (this.pendingPhone) {
            // A user already requested a code — auto-renew immediately instead of showing QR
            this.scheduleAutoRenew(800);
          } else {
            // No pending pairing — show the QR code
            try {
              const qrDataUrl = await QRCode.toDataURL(qr, {
                errorCorrectionLevel: "M",
                margin: 2,
                color: { dark: "#00FF41", light: "#0D0D0D" },
              });
              this.sessionState = {
                ...this.sessionState,
                qr: qrDataUrl,
                qrExpiry: Date.now() + 60000,
                state: "qr_ready",
                connected: false,
                pairingCode: null,
                codeIssuedAt: null,
              };
              this.emit("state-change", this.sessionState);
            } catch (err) {
              logger.error({ err }, "Failed to generate QR code");
            }
          }
        }

        if (connection === "close") {
          this.cancelAutoRenew();
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;
          const isQrTimeout = statusCode === 408;

          logger.info({ statusCode, isLoggedOut }, "Connection closed");

          // Always wipe on 401 (invalid creds). On 408 only wipe if no pending phone
          // (if pendingPhone is set, we want to restart fresh and auto-renew the code)
          if (isLoggedOut || isQrTimeout) {
            fullyConnected = false;
            this.clearAuthDir();
          }

          this.sessionState = {
            ...this.sessionState,
            connected: false,
            state: "connecting",
            qr: null,
          };
          this.emit("state-change", this.sessionState);

          setTimeout(() => this.start(), 3000);
        } else if (connection === "open") {
          this.cancelAutoRenew();
          fullyConnected = true;
          this.pendingPhone = null;
          await saveCreds();

          const phone = this.sock?.user?.id?.split(":")[0] || null;
          this.sessionState = {
            ...this.sessionState,
            connected: true,
            phone,
            state: "connected",
            qr: null,
            qrExpiry: null,
            pairingCode: null,
            codeIssuedAt: null,
          };
          logger.info({ phone }, "WhatsApp connection opened — device linked!");
          this.emit("state-change", this.sessionState);
        } else if (connection === "connecting") {
          this.sessionState = {
            ...this.sessionState,
            state: "connecting",
          };
          this.emit("state-change", this.sessionState);
        }
      });

      this.sock.ev.on("creds.update", guardedSaveCreds);

      logger.info("Baileys session started");
    } catch (err) {
      logger.error({ err }, "Failed to start Baileys session");
      this.sessionState = {
        ...this.sessionState,
        state: "disconnected",
        connected: false,
      };
      setTimeout(() => this.start(), 5000);
    }
  }

  async requestPairingCode(phoneNumber: string): Promise<string> {
    if (!this.sock) {
      throw new Error("Socket not initialized. Please wait for connection to start.");
    }

    const cleanPhone = phoneNumber.replace(/\D/g, "");
    if (!cleanPhone || cleanPhone.length < 7) {
      throw new Error("Invalid phone number");
    }

    try {
      const code = await this.sock.requestPairingCode(cleanPhone);
      const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code;

      // Store the phone so the code auto-renews on every socket restart
      this.pendingPhone = cleanPhone;

      this.sessionState = {
        ...this.sessionState,
        state: "code_ready",
        pairingCode: formattedCode,
        codeIssuedAt: Date.now(),
        qr: null,
      };
      this.emit("state-change", this.sessionState);

      logger.info({ phone: cleanPhone, code: formattedCode }, "Pairing code issued");
      return formattedCode;
    } catch (err) {
      logger.error({ err }, "Failed to request pairing code");
      throw err;
    }
  }

  clearPendingPhone() {
    this.pendingPhone = null;
    this.cancelAutoRenew();
  }

  getState(): SessionState {
    return this.sessionState;
  }

  getQr(): { qr: string; expiry: number } | null {
    if (!this.sessionState.qr) return null;
    return {
      qr: this.sessionState.qr,
      expiry: this.sessionState.qrExpiry || Date.now() + 60000,
    };
  }
}

let sessionInstance: BaileysSession | null = null;

export function getSession(): BaileysSession {
  if (!sessionInstance) {
    sessionInstance = new BaileysSession();
    sessionInstance.start().catch((err) => {
      logger.error({ err }, "Failed to initialize session");
    });
  }
  return sessionInstance;
}

export { BaileysSession };
