import { config } from "dotenv";
import { join } from "path";

config({ path: join(__dirname, "..", "..", "..", ".env") });

import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import { datasetsRouter } from "./routes/datasets";
import { entitiesRouter } from "./routes/entities";
import { contextRouter } from "./routes/context";
import { standardizationRouter } from "./routes/standardization";
import { atumRouter } from "./routes/atum";
import { tbmRouter } from "./routes/tbm";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/datasets", datasetsRouter);
app.use("/api/entities", entitiesRouter);
app.use("/api/context", contextRouter);
app.use("/api/standardization", standardizationRouter);
app.use("/api/atum", atumRouter);
app.use("/api/tbm", tbmRouter);

// Every async handler is wrapped in `wrap()` (src/wrap.ts), so any thrown or
// rejected error lands here instead of per-route try/catch or a process crash.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(PORT, () => {
  console.log(`TBM Trust API listening on http://localhost:${PORT}`);
});
