import imageCompression from 'browser-image-compression'

const COMPRESSION_OPTIONS = {
  maxSizeMB: 1,
  maxWidthOrHeight: 2048,
  useWebWorker: true,
  initialQuality: 0.85,
}

// Minimum size worth compressing — files under this are already small enough
const MIN_SIZE_BYTES = 200 * 1024

/**
 * Compress a single image file before upload.
 * Non-image files, SVGs, GIFs, and already-small files are returned unchanged.
 * Format is preserved (JPEG stays JPEG, PNG stays PNG, WebP stays WebP).
 */
export async function compressImageFile(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) {return file}
  // SVGs are vector — canvas re-encoding would rasterize them
  if (file.type === 'image/svg+xml') {return file}
  // Animated GIFs would lose animation through canvas re-encoding
  if (file.type === 'image/gif') {return file}
  if (file.size <= MIN_SIZE_BYTES) {return file}

  const compressed = await imageCompression(file, COMPRESSION_OPTIONS)

  // Web Worker blob transfer loses both filename and MIME type.
  // Always reconstruct with originals so the server sees the correct
  // originalname (for extension) and Content-Type (for image detection).
  return new File([compressed], file.name, { type: file.type })
}

/**
 * Compress multiple image files in parallel.
 * Non-image files pass through unchanged.
 */
export async function compressImageFiles(files: File[]): Promise<File[]> {
  return Promise.all(files.map(compressImageFile))
}
