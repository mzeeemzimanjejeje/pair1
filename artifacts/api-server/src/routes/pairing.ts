import { Router, type Request, type Response } from "express";
import { getSession, checkRateLimit } from "../lib/baileys-session";
import { RequestPairingCodeBody } from "@workspace/api-zod";

const router = Router();

// GET /api/pair/status
router.get("/status", async (req: Request, res: Response) => {
  try {
    const state = getSession().getState();
    return res.status(200).json({
      connected: state.connected,
      phone: state.phone,
      state: state.state,
      sessionId: state.sessionId ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get pairing status");
    return res.status(503).json({ error: "internal_error", message: "Failed to retrieve status" });
  }
});

// POST /api/pair/code — request a new pairing code
router.post("/code", async (req: Request, res: Response) => {
  try {
    const parsed = RequestPairingCodeBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid_request", message: "Invalid phone number format" });
    }

    const cleanPhone = parsed.data.phoneNumber.replace(/\D/g, "");

    if (!cleanPhone || cleanPhone.length < 7) {
      return res.status(400).json({
        error: "invalid_phone",
        message: "Phone number must include country code (e.g. 254712345678)",
      });
    }

    // Check rate limit before touching the session
    const { ok, retryInMs } = checkRateLimit(cleanPhone);
    if (!ok) {
      const seconds = Math.ceil(retryInMs / 1000);
      return res.status(429).json({
        error: "rate_limited",
        message: `Please wait ${seconds}s before requesting a new code.`,
        retryAfterMs: retryInMs,
      });
    }

    const session = getSession();

    if (session.getState().connected) {
      return res.status(400).json({ error: "already_connected", message: "WhatsApp is already linked" });
    }

    const code = await session.requestPairingCode(cleanPhone);
    return res.status(200).json({ code, phoneNumber: cleanPhone });
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to request pairing code");
    const msg = err instanceof Error ? err.message : "Failed to generate pairing code";

    // Map known error patterns to HTTP codes
    if (msg.includes("wait")) {
      return res.status(429).json({ error: "rate_limited", message: msg });
    }
    if (msg.includes("Socket not ready")) {
      return res.status(503).json({ error: "not_ready", message: msg });
    }
    return res.status(503).json({ error: "pairing_failed", message: msg });
  }
});

// POST /api/pair/entered — frontend calls this when the user says they've entered the code
router.post("/entered", async (req: Request, res: Response) => {
  try {
    getSession().markCodeEntered();
    return res.status(200).json({ message: "Waiting for WhatsApp confirmation" });
  } catch (err) {
    req.log.error({ err }, "Failed to mark code as entered");
    return res.status(503).json({ error: "internal_error", message: "Failed to update state" });
  }
});

// POST /api/pair/reset — wipe session and restart
router.post("/reset", async (req: Request, res: Response) => {
  try {
    const session = getSession();
    if (session.getState().connected) {
      return res.status(400).json({ error: "already_connected", message: "Cannot reset an active session" });
    }

    session.clearPendingPhone();

    const { default: fs } = await import("fs");
    fs.rmSync((session as any).sessionDir, { recursive: true, force: true });
    fs.mkdirSync((session as any).sessionDir, { recursive: true });

    session.sessionState = {
      connected: false,
      phone: null,
      state: "connecting",
      pairingCode: null,
      codeIssuedAt: null,
      lastError: null,
    };

    setTimeout(() => {
      session.start().catch((err: unknown) => {
        req.log.error({ err }, "Failed to restart session after reset");
      });
    }, 500);

    return res.status(200).json({ message: "Session reset. A new code can be requested in a moment." });
  } catch (err) {
    req.log.error({ err }, "Failed to reset session");
    return res.status(503).json({ error: "reset_failed", message: "Failed to reset session" });
  }
});

// GET /api/pair/qr — kept for backward compatibility
router.get("/qr", (_req: Request, res: Response) => {
  const state = getSession().getState();
  if (state.connected) return res.status(200).json({ qr: null, message: "Already connected" });
  return res.status(503).json({ error: "qr_not_ready", message: "Use pairing code instead" });
});

export default router;
