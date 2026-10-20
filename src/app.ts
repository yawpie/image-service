import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import imagesRouter from "./routes/images";
import { apiKeyAuth } from "./middleware/apiKeyAuth";
import generateApiKey from "./routes/generate";
import logger from "./utils/logger";
import { resolveCorsOrigins } from "./utils/corsOrigins";
import { UPLOAD_ROOT } from "./utils/storage";

const app = express();
app.use(morgan(":method :status :response-time ms", {
  stream: { write: (message: string) => logger.info(message.trim(), { type: "http" }) },
}));
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: resolveCorsOrigins(process.env.CORS_ORIGIN), credentials: true }));
app.use(express.json());
app.use("/uploads", express.static(UPLOAD_ROOT));
app.use("/images", apiKeyAuth, imagesRouter);
app.use("/generate", generateApiKey);
app.get("/", (_req, res) => res.send("Image Service OK"));

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("image.request.failed");
  if (res.headersSent) { res.end(); return; }
  const status = [400, 413, 415].includes(err.status) ? err.status : 500;
  const message = err.type === "entity.too.large" ? "Request too large"
    : err.type === "entity.parse.failed" ? "Invalid JSON"
    : status === 500 ? "internal server error" : "Invalid request";
  res.status(status).json({ error: message });
});

export default app;
