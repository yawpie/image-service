import express from "express";
import { PrismaClient } from "@prisma/client";
import path from "path";
import fs from "fs";

const prisma = new PrismaClient();
const router = express.Router();
const HOST = process.env.HOST || "http://localhost:4000";
const UPLOAD_DIR = process.env.UPLOAD_DIR || "uploads";

router.post("/", async (req: any, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "file is required" });

  const relativePath = path.relative(process.cwd(), file.path).replace(/\\/g, "/");
  const url = `${HOST}/${relativePath}`;

  try {
    const img = await prisma.image.create({
      data: {
        originalName: file.originalname,
        fileName: file.filename,
        mimeType: file.mimetype,
        size: file.size,
        path: relativePath,
        url,
      },
    });
    return res.status(201).json(img);
  } catch (err) {
    try { fs.unlinkSync(file.path); } catch (e) {}
    console.error("DB insert error:", err);
    return res.status(500).json({ error: "internal server error" });
  }
});

router.get("/:id", async (req, res) => {
  const { id } = req.params;
  const img = await prisma.image.findUnique({ where: { id }});
  if (!img) return res.status(404).json({ error: "not found" });
  return res.json(img);
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  const img = await prisma.image.findUnique({ where: { id }});
  if (!img) return res.status(404).json({ error: "not found" });

  try {
    await prisma.image.delete({ where: { id }});
    const filePath = path.join(process.cwd(), img.path);
    try { fs.unlinkSync(filePath); } catch (e) {}
    return res.json({ ok: true });
  } catch (err) {
    console.error("delete error", err);
    return res.status(500).json({ error: "internal server error" });
  }
});

export default router;
