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
}

class BaileysSession extends EventEmitter {
  private sock: WASocket | null = null;
  public sessionDir: string;
  public sessionState: SessionState = {
    connected: false,
    phone: null,
    state: "disconnected",
    qr: null,
    qrExpiry: null,
    pairingCode: null,
  };

  constructor() {
    super();
    this.sessionDir = path.join(process.cwd(), "auth_info_baileys");
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  async start() {
    try {
      const { version } = await fetchLatestBaileysVersion();
      logger.info({ version }, "Using Baileys version");

      const { state: authState, saveCreds } = await useMultiFileAuthState(
        this.sessionDir,
      );

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
            };
            logger.info("QR code generated");
            this.emit("state-change", this.sessionState);
          } catch (err) {
            logger.error({ err }, "Failed to generate QR code");
          }
        }

        if (connection === "close") {
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;

          logger.info({ statusCode, isLoggedOut }, "Connection closed");

          // If logged out / credentials rejected, wipe the session so we can re-pair fresh
          if (isLoggedOut) {
            try {
              fs.rmSync(this.sessionDir, { recursive: true, force: true });
              fs.mkdirSync(this.sessionDir, { recursive: true });
              logger.info("Cleared auth session for fresh pairing");
            } catch (e) {
              logger.error({ e }, "Failed to clear auth session");
            }
          }

          this.sessionState = {
            ...this.sessionState,
            connected: false,
            state: "connecting",
            qr: null,
            pairingCode: null,
          };
          this.emit("state-change", this.sessionState);

          // Always reconnect — a fresh QR will be generated if credentials were cleared
          setTimeout(() => this.start(), 3000);
        } else if (connection === "open") {
          const phone = this.sock?.user?.id?.split(":")[0] || null;
          this.sessionState = {
            ...this.sessionState,
            connected: true,
            phone,
            state: "connected",
            qr: null,
            qrExpiry: null,
            pairingCode: null,
          };
          logger.info({ phone }, "WhatsApp connection opened");
          this.emit("state-change", this.sessionState);
        } else if (connection === "connecting") {
          this.sessionState = {
            ...this.sessionState,
            state: "connecting",
          };
          this.emit("state-change", this.sessionState);
        }
      });

      this.sock.ev.on("creds.update", saveCreds);

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

      this.sessionState = {
        ...this.sessionState,
        state: "code_ready",
        pairingCode: formattedCode,
      };
      this.emit("state-change", this.sessionState);

      return formattedCode;
    } catch (err) {
      logger.error({ err }, "Failed to request pairing code");
      throw err;
    }
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
