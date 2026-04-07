import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { recordRequest } from "./lib/stats";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Track stats for every API response
app.use((req: Request, res: Response, next: NextFunction) => {
  res.on("finish", () => {
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
    recordRequest(ip, res.statusCode);
  });
  next();
});

// API routes first
app.use("/api", router);

// Serve built React frontend if available (same-process deployment on Vercel/Render)
// Check both layouts:
//   local (esbuild):  dist/ → __dirname = .../dist/, public/ is sibling
//   Vercel (ncc):     /var/task/ → __dirname = /var/task/, dist/public/ is included via includeFiles
const frontendDist = [
  path.join(__dirname, "public"),
  path.join(__dirname, "dist", "public"),
].find((p) => fs.existsSync(p));
if (frontendDist) {
  app.use(express.static(frontendDist));
  // SPA fallback — return index.html for any non-API route
  app.get(/^(?!\/api).*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
}

export default app;
