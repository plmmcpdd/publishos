import { NextFunction, Request, Response } from 'express';
import { resolveLanguage, translate } from '../i18n';

declare global {
  namespace Express {
    interface Locals {
      language: string;
      t: (key: string) => string;
    }
  }
}

export function languageMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.header('accept-language');
  res.locals.language = resolveLanguage(header);
  res.locals.t = (key: string) => translate(res.locals.language, key);
  next();
}
