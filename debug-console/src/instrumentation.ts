export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initDatabase } = await import('./lib/supportplane/db/l1-transcript-db');
    initDatabase().catch(() => {});
  }
}
