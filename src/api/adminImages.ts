// BE-003: product image upload, patch and delete. Mounted behind requireAdmin.
import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { MAX_IMAGE_BYTES } from '../../contracts/types';
import { HttpError } from '../shared/http';
import type { ImageService } from '../services/images';
import { validationError } from '../services/validation';
import { idParam } from './params';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 5, fieldSize: 1024 },
}).single('image');

/** Runs multer and maps its failures onto the error contract. */
function parseUpload(req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    upload(req, res, (err: unknown) => {
      if (!err) return resolve();
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return reject(new HttpError(413, 'FILE_TOO_LARGE', 'The image must be 5 MB or smaller.'));
        }
        const field = err.field ?? 'image';
        return reject(validationError([{ field, message: uploadMessage(err.code) }]));
      }
      reject(validationError([{ field: 'body', message: "The upload couldn't be read. Try again." }]));
    });
  });
}

function uploadMessage(code: multer.ErrorCode): string {
  switch (code) {
    case 'LIMIT_UNEXPECTED_FILE':
    case 'LIMIT_FILE_COUNT':
      return 'Send exactly one file, in the "image" field.';
    case 'LIMIT_FIELD_VALUE':
      return 'This field is too long.';
    default:
      return 'The upload has too many parts.';
  }
}

export function adminImagesRouter(images: ImageService): Router {
  const router = Router();

  router.post('/products/:id/images', async (req, res) => {
    const productId = idParam(req, 'id');
    // Fail fast before reading the file; the service checks again after parsing.
    images.assertCanAddImage(productId);
    await parseUpload(req, res);
    const created = await images.upload(productId, req.file?.buffer, req.body);
    res.status(201).json(created);
  });

  router.patch('/products/:id/images/:imageId', (req, res) => {
    const productId = idParam(req, 'id');
    const imageId = idParam(req, 'imageId');
    res.json(images.update(productId, imageId, req.body));
  });

  router.delete('/products/:id/images/:imageId', async (req, res) => {
    const productId = idParam(req, 'id');
    const imageId = idParam(req, 'imageId');
    await images.remove(productId, imageId);
    res.status(204).end();
  });

  return router;
}
