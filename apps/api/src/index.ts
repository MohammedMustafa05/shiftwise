import cors from "cors";
import dotenv from "dotenv";
import express from "express";

dotenv.config({ path: "../../.env" });

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "shiftwise-api" });
});

app.get("/api", (_req, res) => {
  res.json({
    name: "ShiftWise API",
    version: "0.1.0",
    docs: "See README for endpoint list",
  });
});

app.listen(PORT, () => {
  console.log(`ShiftWise API running on http://localhost:${PORT}`);
});
