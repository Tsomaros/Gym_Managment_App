/** The longest side of a stored member photo, and its JPEG quality (spec §6.0). */
export const PHOTO_MAX_SIDE = 800;
export const PHOTO_QUALITY = 0.85;

interface Decoded {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number) => void;
  release: () => void;
}

/** Decodes a picture, upright as the camera held it (EXIF orientation is applied). */
async function decode(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return {
      width: bitmap.width,
      height: bitmap.height,
      draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
      release: () => bitmap.close?.(),
    };
  }
  // Older browsers: decode through an <img>.
  const url = URL.createObjectURL(file);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('not an image'));
    };
    img.src = url;
  });
  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
    release: () => URL.revokeObjectURL(url),
  };
}

/**
 * Shrinks a picture to at most 800 px on its longest side (never enlarging) and encodes it as a
 * JPEG at quality 0.85, so a 12-megapixel phone photo becomes a small upload. Rejects when the
 * file is not a picture the browser can read.
 */
export async function resizeImage(file: Blob, maxSide: number = PHOTO_MAX_SIDE): Promise<Blob> {
  const source = await decode(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(source.width, source.height));
    const width = Math.round(source.width * scale);
    const height = Math.round(source.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no canvas');
    source.draw(ctx, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('could not encode'))),
        'image/jpeg',
        PHOTO_QUALITY,
      ),
    );
  } finally {
    source.release();
  }
}
