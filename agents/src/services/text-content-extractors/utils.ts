const CONTENT_EXTRACTOR_TIMEOUT_MS = 30_000
const TIMEOUT_FALLBACK = 'This file took too long to process and could not be extracted. Please describe its contents in your message so I can use it to build your site.'

export async function runWithTimeout(promise: Promise<string>): Promise<string> {
  return Promise.race([
    promise,
    new Promise<string>((resolve) =>
      setTimeout(() => resolve(TIMEOUT_FALLBACK), CONTENT_EXTRACTOR_TIMEOUT_MS)
    ),
  ])
}
