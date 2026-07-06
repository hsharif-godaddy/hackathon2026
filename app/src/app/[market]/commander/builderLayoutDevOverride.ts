import { type BuilderLayoutDescriptor } from '@airo/shared'

type DevOverrideToken = 'immersive' | 'default' | 'commander' | 'develop'

const TOKENS: readonly DevOverrideToken[] = ['immersive', 'default', 'commander', 'develop']

function tokenToDescriptor(token: DevOverrideToken): BuilderLayoutDescriptor {
  return { version: 1, layout: token }
}

function isToken(value: string | null): value is DevOverrideToken {
  return value !== null && (TOKENS as readonly string[]).includes(value)
}

export function readBuilderLayoutDevOverride(): BuilderLayoutDescriptor | undefined {
  if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined') return undefined

  const fromQuery = new URLSearchParams(window.location.search).get('builderLayout')
  const raw = fromQuery ?? window.localStorage.getItem('builderLayout')
  if (!isToken(raw)) return undefined

  return tokenToDescriptor(raw)
}
