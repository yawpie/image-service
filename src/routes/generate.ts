import { Router } from "express";
import { createHash, timingSafeEqual } from "crypto";
import { validate as isUuid } from "uuid";
import { createApiKey } from "../services/apiKeyService";
import { validateAdminId } from "../utils/checkAdminId";
import logger from "../utils/logger";

const router = Router();

router.post("/", async (req, res) => {
  const secret = process.env.IMAGE_SERVICE_PROVISIONING_KEY;
  if (!secret?.trim()) return res.status(503).json({ error: "Provisioning unavailable" });
  const supplied = req.header("x-provisioning-key");
  if (!supplied || !timingSafeEqual(createHash("sha256").update(supplied).digest(), createHash("sha256").update(secret).digest())) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { serviceName, adminId } = req.body ?? {};
  if (typeof adminId !== "string" || !isUuid(adminId)) return res.status(400).json({ error: "adminId must be a UUID" });
  if (typeof serviceName !== "string" || !serviceName.trim() || serviceName.trim().length > 255) {
    return res.status(400).json({ error: "serviceName must contain 1 to 255 characters" });
  }

  try {
    if (!await validateAdminId(adminId)) return res.status(403).json({ error: "Forbidden" });
    const { rawKey } = await createApiKey(serviceName.trim(), adminId);
    return res.status(201).json({ message: "success", key: rawKey });
  } catch {
    logger.error("image.provisioning.failed");
    return res.status(500).json({ error: "internal server error" });
  }
});
export default router;
