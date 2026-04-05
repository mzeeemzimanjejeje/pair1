import { Router, type Request, type Response } from "express";
import { getStats } from "../lib/stats";

const router = Router();

router.get("/", (_req: Request, res: Response) => {
  return res.status(200).json(getStats());
});

export default router;
