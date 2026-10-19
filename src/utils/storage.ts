import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { BadRequestError } from "../error/responseError";

export const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || "uploads");

export function ensureDirSync(dirPath: string) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function generateDestination(baseDir: string) {
  ensureDirSync(baseDir);
  return baseDir;
}

export function generateFilename() {
  return `${uuidv4()}.webp`;
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

export function resolveStoragePath(storedPath: string) {
  const candidate = path.resolve(storedPath);
  if (candidate === UPLOAD_ROOT || !isWithin(UPLOAD_ROOT, candidate)) throw new BadRequestError("Invalid storage path");
  // Reject symlinked ancestors before creating directories or touching a file.
  let ancestor = candidate;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (!isWithin(fs.realpathSync(UPLOAD_ROOT), fs.realpathSync(ancestor))) throw new BadRequestError("Invalid storage path");
  return candidate;
}
