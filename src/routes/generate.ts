import { Router } from "express";
import { createApiKey } from "../services/apiKeyService";
import { validateAdminId } from "../utils/checkAdminId";
import { checkDuplicateKey, deletePreviousKey } from "../utils/duplicateApiKey";

const router = Router();

router.post("/", async (req, res) => {
  const { serviceName, adminId } = req.body;
  const { verbose } = req.query;

  try {
    if (!adminId) {
      return res.status(400).json({ error: "adminId is required" });
    }

    if (!serviceName) {
      return res.status(400).json({ error: "serviceName is required" });
    }
    const isValidAdmin = await validateAdminId(adminId);
    if (!isValidAdmin) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const isDuplicate = await checkDuplicateKey(adminId);
    if (isDuplicate) {
      await deletePreviousKey(adminId);
    }
    const { rawKey, apiKey } = await createApiKey(serviceName, adminId);
    if (verbose === "true") {
      return res.status(201).json({ message: "success", key: rawKey, apiKey });
    } else {
      return res.status(201).json({ message: "success", key: rawKey });
    }
  } catch (error) {
    console.error("Error generating API key:", error);
    return res.status(500).json({ error: "internal server error" });
  }
});
export default router;
