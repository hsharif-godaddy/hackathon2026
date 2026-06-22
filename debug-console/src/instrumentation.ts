export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { warmTranscriptCache } = await import('./lib/l1-transcript-db');
    warmTranscriptCache().catch(() => {});
  }
}
