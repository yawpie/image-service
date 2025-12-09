import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import dotenv from "dotenv";
import imagesRouter from "./routes/images";
import { upload } from "./middleware/upload";
import { apiKeyAuth } from "./middleware/apiKeyAuth";
import generateApiKey from "./routes/generate";
// import debugRouter from "./routes/debug";
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 4000);
const UPLOAD_DIR = process.env.UPLOAD_DIR || "uploads";

// helmet: allow cross-origin resources
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(
  cors({
    origin: JSON.parse(process.env.CORS_ORIGIN || '[]'), // adjust to match frontend origin
    credentials: true
  })
);

app.use(express.json());

// serve static with explicit CORS header (extra safety)
app.use(`/${UPLOAD_DIR}`, express.static(path.join(process.cwd(), UPLOAD_DIR), {
  setHeaders: (res) => {
    // Set CORS header for static files if configured
    if (process.env.STATIC_ORIGIN) {
      res.setHeader("Access-Control-Allow-Origin", process.env.STATIC_ORIGIN);
      // if using credentials:
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
  }
}));
app.post("/images", apiKeyAuth, upload.single("image"), imagesRouter);
app.use("/images", apiKeyAuth, imagesRouter);
// app.use("/", debugRouter);
app.use("/generate", generateApiKey);

app.get("/", (req, res) => res.send("Image Service OK"));

app.listen(PORT, () => { 
  console.log(`Image Service listening on port ${PORT}`);
});
