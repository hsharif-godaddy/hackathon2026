import type { Request, Response, NextFunction, RequestHandler } from 'express'

// Express 4 does not auto-forward rejections from async handlers to the error
// middleware — a thrown error or rejected promise becomes an unhandled
// rejection and the client hangs with no response. Wrap every async handler
// and async middleware with this so Express's registered error middleware
// can produce a 500.
type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>

export const asyncHandler = (fn: AsyncHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}
