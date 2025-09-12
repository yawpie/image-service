import multer from "multer";
import { Request } from "express";
import { generateDestination, generateFilename } from "../utils/storage";
import dotenv from "dotenv";

dotenv.config();

const UPLOAD_DIR = process.env.UPLOAD_DIR || "uploads";
const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE || 5_242_880);
const ALLOWED = (process.env.ALLOWED_MIME || "image/jpeg,image/png").split(",");

const storage = multer.diskStorage({
  destination: (req: Request, file: Express.Multer.File, cb) => {
    const dest = generateDestination(UPLOAD_DIR);
    cb(null, dest);
  },
  filename: (req: Request, file: Express.Multer.File, cb) => {
    cb(null, generateFilename(file.originalname));
  },
});

function fileFilter(req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (!ALLOWED.includes(file.mimetype)) {
    return cb(null,false);
  }
  cb(null, true);
}

export const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
});
