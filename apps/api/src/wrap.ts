import { RequestHandler } from "express";

// Express 4 does not forward a rejected promise from an async handler — it
// becomes an unhandled rejection that kills the process. Wrapping every async
// route here lets the single error middleware in server.ts replace what was a
// try/catch in each of the ~25 handlers.
export const wrap =
  (handler: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
