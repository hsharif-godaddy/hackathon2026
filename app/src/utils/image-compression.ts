// No-op: compression is handled server-side only (Sharp/MozJPEG)
// to avoid double lossy encoding.

export async function compressImageFile(file: File): Promise<File> {
  return file
}

export async function compressImageFiles(files: File[]): Promise<File[]> {
  return files
}
