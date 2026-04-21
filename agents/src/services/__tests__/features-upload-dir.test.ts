import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('features.ts uploadDir default', () => {
  const originalEnv = process.env

  beforeEach(() => {
    vi.resetModules()
    process.env = { ...originalEnv }
    delete process.env.UPLOAD_DIR
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('should use UPLOAD_DIR env var when set', async () => {
    process.env.UPLOAD_DIR = '/private/uploads'
    const { getFeatures } = await import('../features.js')
    expect(getFeatures().uploadDir).toBe('/private/uploads')
  })

  it('should fall back to persistent private dir when CUSTOMER_APP_DIR is set', async () => {
    delete process.env.UPLOAD_DIR
    process.env.CUSTOMER_APP_DIR = '/app'
    const { getFeatures } = await import('../features.js')
    // getPersistentPrivateDir('/app') returns '/private'
    expect(getFeatures().uploadDir).toBe('/private/uploads')
  })

  it('should fall back to persistent private dir for local dev path', async () => {
    delete process.env.UPLOAD_DIR
    process.env.CUSTOMER_APP_DIR = '/tmp/airo-app-builder/abc123/preview'
    const { getFeatures } = await import('../features.js')
    expect(getFeatures().uploadDir).toBe('/tmp/airo-app-builder/abc123/assets/private/uploads')
  })

  it('should fall back to /tmp/airo-app-builder-uploads when neither UPLOAD_DIR nor CUSTOMER_APP_DIR is set', async () => {
    delete process.env.UPLOAD_DIR
    delete process.env.CUSTOMER_APP_DIR
    const { getFeatures } = await import('../features.js')
    expect(getFeatures().uploadDir).toBe('/tmp/airo-app-builder-uploads')
  })
})
