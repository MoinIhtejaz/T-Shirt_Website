// Path parameter parsing shared by the admin routes.
import type { Request } from 'express';
import { validationError } from '../services/validation';

const POSITIVE_INT = /^[1-9][0-9]*$/;

/** A path parameter that must be a positive integer, else 400 VALIDATION_FAILED. */
export function idParam(req: Request, name: 'id' | 'imageId'): number {
  const raw = req.params[name];
  const value = typeof raw === 'string' && POSITIVE_INT.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value)) {
    throw validationError([{ field: name, message: 'Must be a positive whole number.' }]);
  }
  return value;
}
