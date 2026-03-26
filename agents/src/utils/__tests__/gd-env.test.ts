import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveEnv } from '../gd-env.js'

describe('gd-env', function gdEnvTests() {
  let original: string | undefined

  beforeEach(function save() {
    original = process.env.GODADDY_API_BASE_URL
  })

  afterEach(function restore() {
    if (original === undefined) {
      delete process.env.GODADDY_API_BASE_URL
    } else {
      process.env.GODADDY_API_BASE_URL = original
    }
  })

  describe('#resolveEnv', function resolveTests() {
    it('should return dev for dev-godaddy.com URL', function dev() {
      process.env.GODADDY_API_BASE_URL = 'https://api.dev-godaddy.com'
      expect(resolveEnv()).toBe('dev')
    })

    it('should return test for test-godaddy.com URL', function test() {
      process.env.GODADDY_API_BASE_URL = 'https://api.test-godaddy.com'
      expect(resolveEnv()).toBe('test')
    })

    it('should return prod for production URL', function prod() {
      process.env.GODADDY_API_BASE_URL = 'https://api.godaddy.com'
      expect(resolveEnv()).toBe('prod')
    })

    it('should return prod when env var is unset', function unset() {
      delete process.env.GODADDY_API_BASE_URL
      expect(resolveEnv()).toBe('prod')
    })

    it('should return prod when env var is empty', function empty() {
      process.env.GODADDY_API_BASE_URL = ''
      expect(resolveEnv()).toBe('prod')
    })
  })
})
