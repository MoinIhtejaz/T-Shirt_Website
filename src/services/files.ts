// Image files on disk. Paths are only ever built from a stored filename (through
// path.basename) or from a name generated here, never from request input.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export type ImageExt = 'jpg' | 'png' | 'webp';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Decides the type from magic bytes only. null if it isn't JPEG, PNG or WebP. */
export function detectImageType(buf: Buffer): ImageExt | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

function storedPath(uploadDir: string, filename: string): string {
  return path.join(uploadDir, path.basename(filename));
}

/** Writes the bytes under a fresh random name (never overwriting) and returns that name. */
export async function writeNewImage(uploadDir: string, ext: ImageExt, bytes: Buffer): Promise<string> {
  const filename = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  await fs.writeFile(path.join(uploadDir, filename), bytes, { flag: 'wx' });
  return filename;
}

/** Removes a stored image file. A file that is already gone is not an error. */
export async function removeImageFile(uploadDir: string, filename: string): Promise<void> {
  try {
    await fs.unlink(storedPath(uploadDir, filename));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
