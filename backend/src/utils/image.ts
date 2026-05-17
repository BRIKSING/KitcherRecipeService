import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
]);

const MAX_FULL_PX = 1920;

export function isAllowedMimeType(mime: string): boolean {
  return ALLOWED_MIME_TYPES.has(mime.toLowerCase());
}

export interface ProcessedImages {
  uuid: string;
  fullKey: string;
  thumbKey: string;
  fullBuffer: Buffer;
  thumbBuffer: Buffer;
}

export async function processImage(input: Buffer): Promise<ProcessedImages> {
  const id = uuidv4();

  // Auto-rotate based on EXIF orientation, then convert to JPEG
  const base = sharp(input, { failOnError: false }).rotate();

  const [fullBuffer, thumbBuffer] = await Promise.all([
    base
      .clone()
      .resize(MAX_FULL_PX, MAX_FULL_PX, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer(),
    base
      .clone()
      .resize(400, 400, { fit: 'cover' })
      .jpeg({ quality: 80 })
      .toBuffer(),
  ]);

  return {
    uuid: id,
    fullKey: `images/${id}/full.jpg`,
    thumbKey: `images/${id}/thumb.jpg`,
    fullBuffer,
    thumbBuffer,
  };
}
