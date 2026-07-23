import { config } from "dotenv";
import { join } from "path";

config({ path: join(__dirname, "..", "..", "..", ".env") });

import express from "express";
import cors from "cors";
import { datasetsRouter } from "./routes/datasets";
import { entitiesRouter } from "./routes/entities";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/datasets", datasetsRouter);
app.use("/api/entities", entitiesRouter);

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(PORT, () => {
  console.log(`TBM Trust API listening on http://localhost:${PORT}`);
});
