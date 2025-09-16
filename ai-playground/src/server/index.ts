// Load environment variables
import 'dotenv/config'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import type { Server as HTTPServer } from 'http'

const dev = process.env.NODE_ENV !== 'production'
const hostname = 'localhost'
const port = 3000

// when using middleware `hostname` and `port` must be provided below
const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

async function startServer(): Promise<void> {
  try {
    // Import ESM module
    const { setupWebSocketServer } = await import('../lib/websocket-server.js')
    
    await app.prepare()
    
    const httpServer: HTTPServer = createServer(async (req, res) => {
      try {
        // Be sure to pass `true` as the second argument to `url.parse`.
        // This tells it to parse the query portion of the URL.
        const parsedUrl = parse(req.url!, true)
        await handle(req, res, parsedUrl)
      } catch (err) {
        console.error('Error occurred handling', req.url, err)
        res.statusCode = 500
        res.end('internal server error')
      }
    })

    // Setup WebSocket server
    setupWebSocketServer(httpServer)

    httpServer
      .once('error', (err: Error) => {
        console.error(err)
        process.exit(1)
      })
      .listen(port, () => {
        console.log(`🚀 Server ready on http://${hostname}:${port}`)
        console.log(`📡 WebSocket server ready for connections`)
        console.log(`🤖 AI Playground is running!`)
      })
  } catch (error) {
    console.error('Failed to start server:', error)
    process.exit(1)
  }
}

startServer()
