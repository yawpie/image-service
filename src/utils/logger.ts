import winston from "winston";
import path from "path";

const { combine, timestamp, printf, colorize, errors } = winston.format;

const LOG_DIR = process.env.LOG_DIR || "logs";

// Custom format for console output
const consoleFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
  const msg = stack || message;
  return `[${timestamp}] ${level}: ${msg}${metaStr}`;
});

// Custom format for file output (JSON-based for easy parsing)
const fileFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  return JSON.stringify({
    timestamp,
    level,
    message: stack || message,
    ...meta,
  });
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug"),
  format: combine(
    timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    errors({ stack: true })
  ),
  defaultMeta: { service: "image-service" },
  transports: [
    // Console transport — colorized and human-readable
    new winston.transports.Console({
      format: combine(colorize(), consoleFormat),
    }),

    // File transport — combined logs
    new winston.transports.File({
      filename: path.join(LOG_DIR, "combined.log"),
      format: fileFormat,
      maxsize: 5 * 1024 * 1024, // 5MB
      maxFiles: 5,
    }),

    // File transport — errors only
    new winston.transports.File({
      filename: path.join(LOG_DIR, "error.log"),
      level: "error",
      format: fileFormat,
      maxsize: 5 * 1024 * 1024,
      maxFiles: 5,
    }),
  ],
});

export default logger;
