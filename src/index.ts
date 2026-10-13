import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import dotenv from "dotenv";
import morgan from "morgan";
import imagesRouter from "./routes/images";
import { upload } from "./middleware/upload";
import { apiKeyAuth } from "./middleware/apiKeyAuth";
import generateApiKey from "./routes/generate";
import logger from "./utils/logger";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 4000);
const UPLOAD_DIR = process.env.UPLOAD_DIR || "uploads";

// ─── Logging ────────────────────────────────────────────────────────────────

// Morgan HTTP request logging — streams to winston
const morganFormat = process.env.NODE_ENV === "production" ? "combined" : "short";
const morganStream = {
  write: (message: string) => {
    // Remove trailing newline from morgan
    logger.info(message.trim(), { type: "http" });
  },
};
app.use(morgan(morganFormat, { stream: morganStream }));

// ─── Security ───────────────────────────────────────────────────────────────

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(
  cors({
    origin: JSON.parse(process.env.CORS_ORIGIN || '[]'),
    credentials: true
  })
);

app.use(express.json());

// ─── Static Files ───────────────────────────────────────────────────────────

app.use(`/${UPLOAD_DIR}`, express.static(path.join(process.cwd(), UPLOAD_DIR), {
  setHeaders: (res) => {
    if (process.env.STATIC_ORIGIN) {
      res.setHeader("Access-Control-Allow-Origin", process.env.STATIC_ORIGIN);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
  }
}));

// ─── Routes ─────────────────────────────────────────────────────────────────

app.post("/images", apiKeyAuth, upload.single("image"), imagesRouter);
app.use("/images", apiKeyAuth, imagesRouter);
app.use("/generate", generateApiKey);

app.get("/", (req, res) => res.send("Image Service OK"));

// ─── Global Error Handler ───────────────────────────────────────────────────

app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error("Unhandled error", {
    error: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
  });

  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === "production"
      ? "Internal server error"
      : err.message,
  });
});

// ─── Start Server ───────────────────────────────────────────────────────────

app.listen(PORT, () => {
  logger.info(`Image Service started`, {
    port: PORT,
    env: process.env.NODE_ENV || "development",
    uploadDir: UPLOAD_DIR,
  });
});
