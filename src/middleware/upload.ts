import multer from "multer";
import { RequestHandler } from "express";
import HttpError from "../error/responseError";

export const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE || 10 * 1024 * 1024);
export const MAX_IMAGE_PIXELS = Number(process.env.MAX_IMAGE_PIXELS || 25000000);
for (const limit of [MAX_FILE_SIZE, MAX_IMAGE_PIXELS]) {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("Upload limits must be a positive integer");
}

export const validateUploadFolder: RequestHandler = (req, res, next) => {
  const folder = req.query.folder ?? "default";
  const query = req.originalUrl.split("?")[1] || "";
  if (typeof folder !== "string" || !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(folder) || /%(2f|5c)/i.test(query)) {
    res.status(400).json({ error: "Invalid folder" });
    return;
  }
  res.locals.uploadFolder = folder;
  next();
};

const parseImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1, fields: 10, parts: 11, fieldSize: 16384 },
  fileFilter: (_req, file, cb) => {
    if (!["image/jpeg", "image/jpg", "image/pjpeg", "image/png", "image/webp"].includes(file.mimetype)) {
      cb(new HttpError("Invalid or unsupported image", 415));
      return;
    }
    cb(null, true);
  },
}).single("image");

export const receiveImage: RequestHandler = (req, res, next) => {
  parseImage(req, res, (error) => {
    if (error) {
      const oversized = error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE";
      if (error instanceof HttpError) { res.status(415).json({ error: "Invalid or unsupported image" }); return; }
      res.status(oversized ? 413 : 400).json({ error: oversized ? "File too large" : "Invalid multipart request" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "Image is required" });
      return;
    }
    next();
  });
};
