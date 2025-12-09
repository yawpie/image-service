import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileFilter, MAX_FILE_SIZE } from "../middleware/upload";

const router = Router();

// router.post("/", (req, res) => {
//     let len = 0;
//     req.on("data", chunk => { len += chunk.length; });
//     req.on("end", () => {
//         res.json({ receivedBytes: len, headers: req.headers });
//     });
//     req.on("error", err => res.status(500).json({ err: err.message }));
// });

// for debugging: use memoryStorage temporarily
const testUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE }, fileFilter });

router.post("/internal-upload-debug", testUpload.single("image"), (req, res) => {
    console.log("debug mem file size:", req.file?.size);
    if (req.file && req.file.buffer) {
        console.log("first 16 bytes hex:", req.file.buffer.slice(0,16).toString('hex'));
        // manually save to disk
        const safeFilename = path.basename(req.file.originalname);
        fs.writeFileSync(path.join(process.env.UPLOAD_DIR || "uploads", "dbg-"+Date.now()+"-"+safeFilename), req.file.buffer);
    }
    res.json({ ok: true, size: req.file?.size });
});

export default router;