/**
 * TestPilot Library
 *
 * Comprehensive testing and security scanning services including:
 * - Visual testing
 * - Accessibility testing
 * - Security testing (site)
 * - Code security scanning (npm audit + ESLint)
 */

export { Client, testPilotClient, type TestPilotResponse, type TestPilotRunResult,type TestPilotTaskResponse, type TestType } from './client';
export { getTestPilotConfig } from './config';

