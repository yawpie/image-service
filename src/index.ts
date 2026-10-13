import app from "./app";
import logger from "./utils/logger";

const PORT = Number(process.env.PORT || 4000);
const UPLOAD_DIR = process.env.UPLOAD_DIR || "uploads";

// ─── Start Server ───────────────────────────────────────────────────────────

app.listen(PORT, () => {
  logger.info(`Image Service started`, {
    port: PORT,
    env: process.env.NODE_ENV || "development",
    uploadDir: UPLOAD_DIR,
  });
});
