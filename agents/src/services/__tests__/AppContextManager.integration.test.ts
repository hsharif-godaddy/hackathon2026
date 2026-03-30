import { describe, it, expect, beforeEach } from 'vitest';
import { AppContextManager } from '../AppContextManager.js';
import type { AgentExecutionContext } from '../../base/index.js';
import { existsSync, readdirSync, mkdirSync, rmSync } from 'fs';
import path from 'path';

describe('AppContextManager Integration', () => {
  let appContextManager: AppContextManager;
  let testAppPath: string;
  let mockContext: AgentExecutionContext;

  beforeEach(() => {
    appContextManager = new AppContextManager();
    
    // Find a real existing app for testing
    const appsDir = '/tmp/apps';
    const appDirs = existsSync(appsDir) ? readdirSync(appsDir) : [];
    
    if (appDirs.length === 0) {
      throw new Error('No test apps found in /tmp/apps - integration test requires real app directory');
    }
    
    // Use the first available app directory
    const firstApp = appDirs[0];
    testAppPath = path.join(appsDir, firstApp);
    
    // Verify the app directory has required files
    const packageJsonPath = path.join(testAppPath, 'package.json');
    if (!existsSync(packageJsonPath)) {
      throw new Error(`Test app ${firstApp} is missing package.json file`);
    }

    mockContext = {
      userId: 'test-user',
      threadId: 'test-thread', 
      appId: firstApp,
      timestamp: new Date(),
      metadata: {
        appId: firstApp,  // AppContextManager expects appId in metadata too
        appPath: testAppPath,
        workingDirectory: testAppPath
      }
    };

    console.log(`\n🧪 Testing AppContextManager with real app: ${firstApp}`);
    console.log(`📁 App path: ${testAppPath}`);
  });

  describe('generateContextMessage', () => {
    it('should successfully generate context message with real app data', async () => {
      const result = await appContextManager.generateContextMessage(mockContext);

      expect(result).toBeDefined();
      expect(result.stableContext).toBeDefined();
      expect(typeof result.stableContext).toBe('string');
      expect(result.stableContext!.length).toBeGreaterThan(0);

      console.log('\n📊 Generated context messages:');
      console.log('Stable context length:', result.stableContext?.length || 0);
      console.log('Secrets context length:', result.secretsContext?.length || 0);
      console.log('Media slots context length:', result.mediaSlotsContext?.length || 0);
      console.log('Stable preview:', result.stableContext?.substring(0, 200) + '...');
    });

    it('should include package information in stable context', async () => {
      const result = await appContextManager.generateContextMessage(mockContext);

      expect(result.stableContext).toBeDefined();
      expect(result.stableContext).toContain('[Current Project Context]');

      // Should NOT contain "Package Information: Not available"
      expect(result.stableContext).not.toContain('Package Information: Not available');

      // Should contain actual package info (AppContextManager uses "Project:" format)
      expect(result.stableContext).toContain('Project:');
      expect(result.stableContext).toMatch(/Name: v8-app-template/);
    });

    it('should not include directory structure in context (removed for cache efficiency)', async () => {
      const result = await appContextManager.generateContextMessage(mockContext);

      expect(result.stableContext).toBeDefined();
      expect(result.stableContext).not.toContain('Directory Structure:');

      // Should mention using directoryListing tool instead
      expect(result.stableContext).toContain('directoryListing');
    });

    it('should handle package.json parsing correctly', async () => {
      const packageInfo = await appContextManager['getPackageInfo'](mockContext);

      expect(packageInfo).not.toBeNull();
      expect(packageInfo).toBeDefined();
      expect(packageInfo).toHaveProperty('name');
      expect(packageInfo).toHaveProperty('version');
      expect(packageInfo).toHaveProperty('dependencies');
      expect(packageInfo).toHaveProperty('scripts');

      console.log('\n📦 Package info extracted:');
      console.log('Name:', packageInfo?.name);
      console.log('Version:', packageInfo?.version);
      console.log('Dependencies count:', packageInfo?.dependencies?.length || 0);
      console.log('Scripts count:', packageInfo?.scripts?.length || 0);
    });

    it('should check dependency installation status', async () => {
      const packageInfo = await appContextManager['getPackageInfo'](mockContext);
      
      expect(packageInfo).not.toBeNull();
      expect(packageInfo).toHaveProperty('dependenciesInstalled');
      expect(typeof packageInfo?.dependenciesInstalled).toBe('boolean');
      
      console.log('\n🔧 Dependencies installed:', packageInfo?.dependenciesInstalled);
    });

    it('should handle different working directories correctly', async () => {
      // Test with different execution contexts that might cause the "Path does not exist: ." error
      
      // Test 1: Context with relative path
      const relativeContext = { ...mockContext };
      relativeContext.metadata = { appId: mockContext.appId, appPath: '.' };
      
      await appContextManager.generateContextMessage(relativeContext);
      // This might fail, which would help us reproduce the bug
      
      // Test 2: Context with absolute path (should work)
      const absoluteContext = { ...mockContext };
      absoluteContext.metadata = { 
        appId: mockContext.appId,
        appPath: testAppPath,
        workingDirectory: testAppPath 
      };
      
      const result2 = await appContextManager.generateContextMessage(absoluteContext);
      expect(result2).toBeDefined();
      expect(result2.stableContext).toBeDefined();
      expect(result2.stableContext).not.toContain('Package Information: Not available');
    });
  });

  describe('Error handling', () => {
    it('should handle non-existent app directory gracefully', async () => {
      const badContext = {
        ...mockContext,
        metadata: { appPath: '/non/existent/path' }
      };

      const result = await appContextManager.generateContextMessage(badContext);
      expect(result.stableContext).toBeNull();
      expect(result.secretsContext).toBeNull();
      expect(result.mediaSlotsContext).toBeNull();
    });

    it('should handle missing package.json gracefully', async () => {
      // Create a temporary directory without package.json
      const tempDir = '/tmp/test-app-no-package';
      mkdirSync(tempDir, { recursive: true });
      
      try {
        const badContext = {
          ...mockContext,
          metadata: { appPath: tempDir }
        };

        const packageInfo = await appContextManager['getPackageInfo'](badContext);
        expect(packageInfo).toBeNull();
      } finally {
        // Clean up
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('Performance', () => {
    it('should complete context generation within reasonable time', async () => {
      const start = Date.now();
      
      const result = await appContextManager.generateContextMessage(mockContext);
      
      const duration = Date.now() - start;
      console.log(`\n⏱️  Context generation took: ${duration}ms`);
      
      expect(result).toBeDefined();
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });
});