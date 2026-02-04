/**
 * Test Environment Setup
 *
 * IMPORTANT: These are test-only values and must NOT match production credentials.
 * All tokens, endpoints, and configuration values here are fake and only used for testing.
 *
 * This file is loaded before tests via Jest's setupFiles configuration.
 * It provides the minimum environment variables needed for tests to pass.
 */

process.env.VALID_TOKENS = 'gd-test-token-123,gd-valid-token-123,gd-token-with-spaces';
process.env.GETTY_IMAGES_UPSTREAM = 'https://test.getty.com';
process.env.SSO_ENDPOINT = 'https://test.sso.com';
process.env.LOG_LEVEL = 'error';
