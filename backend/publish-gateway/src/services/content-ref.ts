import { AppError } from '../middleware/errors';

export type ContentRefInput = { provided: boolean; value: string | null };

export function normalizeContentRef(value: unknown): string {
  if (typeof value !== 'string') throw new AppError(422, 'invalid_content_ref', 'contentRef must be a string');
  const normalized = value.trim();
  if (!normalized || normalized.length > 200 || /[\r\n\0]/u.test(normalized)) {
    throw new AppError(422, 'invalid_content_ref', 'contentRef is invalid');
  }
  // A content reference is an identifier, never a filesystem path.
  if (/[\\/]/u.test(normalized)) throw new AppError(422, 'invalid_content_ref', 'contentRef is invalid');
  return normalized;
}

export function contentRefFromAliases(input: Record<string, unknown>): ContentRefInput {
  const hasCamel = Object.prototype.hasOwnProperty.call(input, 'contentRef');
  const hasSnake = Object.prototype.hasOwnProperty.call(input, 'content_ref');
  if (!hasCamel && !hasSnake) return { provided: false, value: null };
  const parse = (value: unknown): string | null => value === null ? null : normalizeContentRef(value);
  const camel = hasCamel ? parse(input.contentRef) : undefined;
  const snake = hasSnake ? parse(input.content_ref) : undefined;
  if (hasCamel && hasSnake && camel !== snake) {
    throw new AppError(422, 'content_ref_conflict', 'contentRef and content_ref must match');
  }
  return { provided: true, value: camel ?? snake ?? null };
}
