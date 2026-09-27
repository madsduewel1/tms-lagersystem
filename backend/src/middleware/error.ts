import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function validate(
  schema: { parse: (data: unknown) => unknown }
): RequestHandler {
  return (req, _res, next) => {
    try {
      req.body = schema.parse(req.body) as typeof req.body;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({ error: `Ressource nicht gefunden: ${req.method} ${req.path}` });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Eingabevalidierung fehlgeschlagen',
      details: err.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      })),
    });
    return;
  }
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Interner Serverfehler' });
};