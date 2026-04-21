import { Router, type IRouter } from 'express'

import { getProfileRegistry } from '../../profiles/index.js'
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js'

const router: IRouter = Router()

router.get('/profiles', (req, res) => {
  const agentContext = (req as AuthenticatedRequest).agentContext
  if (!agentContext?.agentProfileSelectorEnabled) {
    res.status(403).json({ error: 'Profile selection is not enabled' })
    return
  }

  const registry = getProfileRegistry()
  const profiles = [...registry.values()]
    .map(p => ({
      name: p.name,
      description: p.description,
      properties: p.properties,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  res.json({ profiles })
})

export default router
