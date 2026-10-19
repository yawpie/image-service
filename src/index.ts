import app from "./app";
import logger from "./utils/logger";

const PORT = Number(process.env.PORT || 4000);

// ─── Start Server ───────────────────────────────────────────────────────────

app.listen(PORT, () => {
  logger.info("image.service.started", {
    port: PORT,
  });
});
