export default function handler(_req: Request) {
  return new Response(JSON.stringify({
    status: 'ok',
    timestamp: new Date().toISOString(),
    message: 'V7 Template API is running!'
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
