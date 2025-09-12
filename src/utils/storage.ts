import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

export function ensureDirSync(dirPath: string) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

export function generateDestination(baseDir: string) {
  const now = new Date();
  const folder = path.join(
    baseDir,
    String(now.getFullYear()),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  );
  ensureDirSync(folder);
  return folder;
}

export function generateFilename(originalName: string) {
  const ext = path.extname(originalName) || "";
  return `${uuidv4()}${ext}`;
}
