// Product image use cases: upload, patch, delete.
import type { ApiDeps } from '../../contracts/modules';
import { MAX_IMAGES_PER_PRODUCT, type ProductImage } from '../../contracts/types';
import { HttpError } from '../shared/http';
import { toImage } from './dto';
import { detectImageType, removeImageFile, writeNewImage } from './files';
import { productNotFound } from './products';
import { imageUpdateSchema, imageUploadFieldsSchema, parseOrThrow } from './validation';

function imageNotFound(): HttpError {
  return new HttpError(404, 'NOT_FOUND', 'Image not found.');
}

export function createImageService({ repos, config }: Pick<ApiDeps, 'repos' | 'config'>) {
  /** 404 if the product is missing, 409 if it already has the maximum number of images. Returns the product name. */
  function assertCanAddImage(productId: number): string {
    const product = repos.products.getById(productId);
    if (!product) throw productNotFound();
    if (repos.images.countForProduct(productId) >= MAX_IMAGES_PER_PRODUCT) {
      throw new HttpError(
        409,
        'IMAGE_LIMIT_REACHED',
        `A product can have up to ${MAX_IMAGES_PER_PRODUCT} images. Delete one before adding another.`,
      );
    }
    return product.name;
  }

  return {
    assertCanAddImage,

    /**
     * Stores an uploaded image. The client's filename and mimetype are never consulted:
     * the type comes from the magic bytes and the name is random.
     */
    async upload(productId: number, file: Buffer | undefined, fields: unknown): Promise<ProductImage> {
      if (!file) {
        throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Attach a JPEG, PNG or WebP image in the "image" field.');
      }
      const { alt } = parseOrThrow(imageUploadFieldsSchema, fields ?? {});
      const ext = detectImageType(file);
      if (!ext) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'The file must be a JPEG, PNG or WebP image.');

      // Checked again after parsing the upload, in case another upload landed meanwhile.
      const productName = assertCanAddImage(productId);

      const filename = await writeNewImage(config.uploadDir, ext, file);
      try {
        const stored = repos.images.create({ productId, filename, alt: alt || productName });
        return toImage(stored);
      } catch (err) {
        await removeImageFile(config.uploadDir, filename);
        throw err;
      }
    },

    update(productId: number, imageId: number, body: unknown): ProductImage {
      if (!repos.images.get(productId, imageId)) throw imageNotFound();
      const data = parseOrThrow(imageUpdateSchema, body);
      const updated = repos.images.update(productId, imageId, data);
      if (!updated) throw imageNotFound();
      return toImage(updated);
    },

    async remove(productId: number, imageId: number): Promise<void> {
      const image = repos.images.get(productId, imageId);
      if (!image) throw imageNotFound();
      await removeImageFile(config.uploadDir, image.filename);
      repos.images.delete(productId, imageId);
    },
  };
}

export type ImageService = ReturnType<typeof createImageService>;
