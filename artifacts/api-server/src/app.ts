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
const frontendDist = [
  path.join(__dirname, "public"),                                         // esbuild: dist/__dirname, public/ sibling
  path.join(__dirname, "dist", "public"),                                 // Vercel ncc: /var/task/dist/public
  path.join(process.cwd(), "artifacts/api-server/dist/public"),          // Render: repo root CWD
  path.join(process.cwd(), "dist/public"),                               // generic fallback
].find((p) => fs.existsSync(p));
logger.info({ frontendDist: frontendDist ?? "not found" }, "Frontend dist path");
if (frontendDist) {
  app.use(express.static(frontendDist));
  // SPA fallback — return index.html for any non-API route
  app.get(/^(?!\/api).*/, (_req: Request, res: Response) => {
    res.sendFile(path.join(frontendDist, "index.html"));
  });
} else {
  // Frontend not built yet — serve a minimal status page so GET / never returns "Cannot GET /"
  app.get("/", (_req: Request, res: Response) => {
    res.status(200).send(`<!DOCTYPE html><html><body><h2>TRUTH-MD Pairing API is running.</h2><p>Frontend not found. Check build logs.</p><p>API: <a href="/api/health">/api/health</a></p></body></html>`);
  });
}

export default app;
