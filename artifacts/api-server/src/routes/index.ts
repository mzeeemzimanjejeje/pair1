import { Router, type IRouter } from "express";
import healthRouter from "./health";
import pairingRouter from "./pairing";
import statsRouter from "./stats";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/pair", pairingRouter);
router.use("/stats", statsRouter);

export default router;
