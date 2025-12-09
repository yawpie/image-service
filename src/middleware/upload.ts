import multer from "multer";
import { Request } from "express";
import { generateDestination, generateFilename } from "../utils/storage";
import dotenv from "dotenv";

dotenv.config();

const UPLOAD_DIR = process.env.UPLOAD_DIR || "uploads";
export const MAX_FILE_SIZE = Number(process.env.MAX_FILE_SIZE || 10 * 1024 * 1024); // 10 MB
// 'image/pjpeg' is a legacy MIME type used by older Internet Explorer versions; included for compatibility.
const ALLOWED = (process.env.ALLOWED_MIME || "image/jpeg,image/png,image/webp,image/pjpeg").split(",");

const storage = multer.diskStorage({
  destination: (req: Request, file: Express.Multer.File, cb) => {
    const { folder } = req.query as { folder?: string };
    const dest = generateDestination(UPLOAD_DIR + (folder ? `/${folder}` : "/default"));
    cb(null, dest);
  },
  filename: (req: Request, file: Express.Multer.File, cb) => {
    cb(null, generateFilename(file.originalname));
  },
});

export function fileFilter(req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  if (!ALLOWED.includes(file.mimetype)) {
    return cb(null,false);
  }
  cb(null, true);
}
// export function fileFilter(req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
//   // log mimetype for debugging
//   console.log("upload file mimetype:", file.mimetype, "originalname:", file.originalname);

//   if (!ALLOWED.includes(file.mimetype)) {
//     // pass a clear error so client can see why upload ditolak
//     const err: any = new multer.MulterError("LIMIT_UNEXPECTED_FILE", file.fieldname);
//     err.message = `Invalid file type: ${file.mimetype}`;
//     console.log("upload file error:", err.message);
    
//     return cb(err, false);
//     // const err = new Error(`Invalid file type: ${file.mimetype}`);
//     // // optional: beri properti kode supaya mudah deteksi
//     // (err as any).code = "INVALID_FILE_TYPE";
//     // console.log("upload file rejected:", err.message);
//     // return cb(null, false);
//   }
//   cb(null, true);
// }

export const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
});
