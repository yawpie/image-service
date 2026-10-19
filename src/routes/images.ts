import express, { Request, Response } from "express";
import { prisma } from "../lib/prisma";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import { MAX_IMAGE_PIXELS, receiveImage, validateUploadFolder } from "../middleware/upload";
import { UPLOAD_ROOT, ensureDirSync, generateFilename, resolveStoragePath } from "../utils/storage";
import { BadRequestError } from "../error/responseError";
import logger from "../utils/logger";

const router = express.Router();
const HOST = (process.env.HOST || "http://localhost:4000").replace(/\/$/, "");

router.post("/", validateUploadFolder, receiveImage, async (req: Request, res: Response) => {
  const file = req.file!;
  let encoded: Buffer;
  try {
    const bytes = file.buffer;
    const png = bytes.toString("hex", 0, 8) === "89504e470d0a1a0a";
    const bitmap = (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
      || png
      || (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP");
    if (!bitmap) throw new Error("Unsupported bitmap");
    // libpng can decode pixels even when the final IEND chunk is truncated.
    if (png && bytes.subarray(-12).toString("hex") !== "0000000049454e44ae426082") throw new Error("Incomplete PNG");
    const source = sharp(bytes, { failOn: "warning", limitInputPixels: MAX_IMAGE_PIXELS });
    const metadata = await source.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format || "") || (metadata.pages || 1) > 1) throw new Error("Unsupported bitmap");
    encoded = await source.rotate().webp({ quality: 85 }).toBuffer();
  } catch {
    return res.status(415).json({ error: "Invalid or unsupported image" });
  }

  let createdPath: string | undefined;
  try {
    ensureDirSync(UPLOAD_ROOT);
    const folder: string = res.locals.uploadFolder;
    const destination = resolveStoragePath(path.join(UPLOAD_ROOT, folder));
    ensureDirSync(destination);
    const fileName = generateFilename();
    const diskPath = resolveStoragePath(path.join(destination, fileName));
    const handle = await fs.promises.open(diskPath, "wx");
    createdPath = diskPath;
    try { await handle.writeFile(encoded); } finally { await handle.close(); }
    const storedPath = path.relative(process.cwd(), diskPath).replace(/\\/g, "/");
    const img = await prisma.image.create({
      data: {
        originalName: file.originalname,
        fileName,
        mimeType: "image/webp",
        size: encoded.length,
        path: storedPath,
        url: `${HOST}/uploads/${folder}/${fileName}`,
      },
    });
    return res.status(201).json(img);
  } catch (error) {
    if (createdPath) {
      try { await fs.promises.unlink(createdPath); } catch { logger.error("image.upload.cleanup.failed"); }
    }
    if (error instanceof BadRequestError) return res.status(400).json({ error: "Invalid folder" });
    logger.error("image.upload.failed");
    return res.status(500).json({ error: "internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const img = await prisma.image.findUnique({ where: { id: req.params.id } });
    if (!img) return res.status(404).json({ error: "not found" });
    return res.json(img);
  } catch {
    logger.error("image.metadata.failed");
    return res.status(500).json({ error: "internal server error" });
  }
});

router.delete("/", async (req, res) => {
  const { url } = req.query;
  if (typeof url !== "string") return res.status(400).json({ error: "url must be a string" });
  if (!url) return res.status(400).json({ error: "url is required" });
  try {
    const img = await prisma.image.findUnique({ where: { url } });
    if (!img) return res.status(404).json({ error: "not found" });
    const diskPath = resolveStoragePath(img.path);
    await prisma.image.delete({ where: { url } });
    try { await fs.promises.unlink(diskPath); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") logger.error("image.delete.file.failed");
    }
    return res.json({ message: "success" });
  } catch {
    logger.error("image.delete.failed");
    return res.status(500).json({ error: "internal server error" });
  }
});

export default router;
