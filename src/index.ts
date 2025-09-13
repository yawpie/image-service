import express from "express";
import cors from "cors";
import helmet from "helmet";
import path from "path";
import dotenv from "dotenv";
import imagesRouter from "./routes/images";
import { upload } from "./middleware/upload";
import { apiKeyAuth } from "./middleware/apiKeyAuth";
import generateApiKey from "./routes/generate";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 4000);
const UPLOAD_DIR = process.env.UPLOAD_DIR || "uploads";

app.use(helmet());
app.use(cors());
app.use(express.json());

app.use(`/${UPLOAD_DIR}`, express.static(path.join(process.cwd(), UPLOAD_DIR)));

app.post("/images", apiKeyAuth, upload.single("image"), imagesRouter);
app.use("/images", apiKeyAuth, imagesRouter);
app.use("/generate", generateApiKey);

app.get("/", (req, res) => res.send("Image Service OK"));

app.listen(PORT, () => {
  console.log(`Image Service listening on port ${PORT}`);
});
