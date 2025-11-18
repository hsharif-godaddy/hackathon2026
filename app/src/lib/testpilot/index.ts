/**
 * TestPilot Library
 *
 * Comprehensive testing and security scanning services including:
 * - Visual testing
 * - Accessibility testing
 * - Security testing (site)
 * - Code security scanning (npm audit + ESLint)
 */

export { getTestPilotConfig } from './config';
export { testPilotClient, Client, type TestType, type TestPilotResponse, type TestPilotTaskResponse } from './client';

