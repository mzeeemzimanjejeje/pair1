import { Router, type Request, type Response } from "express";
import { getSession } from "../lib/baileys-session";
import {
  RequestPairingCodeBody,
} from "@workspace/api-zod";

const router = Router();

router.get("/qr", async (req: Request, res: Response) => {
  try {
    const session = getSession();
    const qrData = session.getQr();

    if (!qrData) {
      const state = session.getState();
      if (state.connected) {
        return res.status(200).json({
          qr: null,
          expiry: null,
          message: "Already connected",
        });
      }
      return res.status(503).json({
        error: "qr_not_ready",
        message: "QR code not yet available. Please wait...",
      });
    }

    return res.status(200).json({
      qr: qrData.qr,
      expiry: qrData.expiry,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get QR code");
    return res.status(503).json({
      error: "internal_error",
      message: "Failed to retrieve QR code",
    });
  }
});

router.post("/code", async (req: Request, res: Response) => {
  try {
    const parsed = RequestPairingCodeBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "invalid_request",
        message: "Invalid phone number format",
      });
    }

    const { phoneNumber } = parsed.data;
    const cleanPhone = phoneNumber.replace(/\D/g, "");

    if (!cleanPhone || cleanPhone.length < 7) {
      return res.status(400).json({
        error: "invalid_phone",
        message: "Phone number must be at least 7 digits with country code",
      });
    }

    const session = getSession();
    const state = session.getState();

    if (state.connected) {
      return res.status(400).json({
        error: "already_connected",
        message: "WhatsApp is already connected",
      });
    }

    const code = await session.requestPairingCode(cleanPhone);

    return res.status(200).json({
      code,
      phoneNumber: cleanPhone,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to request pairing code");
    return res.status(503).json({
      error: "pairing_failed",
      message:
        err instanceof Error ? err.message : "Failed to generate pairing code",
    });
  }
});

router.get("/status", async (req: Request, res: Response) => {
  try {
    const session = getSession();
    const state = session.getState();

    return res.status(200).json({
      connected: state.connected,
      phone: state.phone,
      state: state.state,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get pairing status");
    return res.status(503).json({
      error: "internal_error",
      message: "Failed to retrieve pairing status",
    });
  }
});

export default router;
