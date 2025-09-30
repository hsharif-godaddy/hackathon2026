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
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
      
      console.log('\n📊 Generated context message:');
      console.log('Length:', result.length);
      console.log('Preview:', result.substring(0, 200) + '...');
    });

    it('should include package information in context', async () => {
      const result = await appContextManager.generateContextMessage(mockContext);
      
      expect(result).toBeDefined();
      expect(result).toContain('[Current Project Context]');
      
      // Should NOT contain "Package Information: Not available" 
      expect(result).not.toContain('Package Information: Not available');
      
      // Should contain actual package info (AppContextManager uses "Project:" format)
      expect(result).toContain('Project:');
      expect(result).toMatch(/Name: v8-app-template/);
    });

    it('should include directory structure in context', async () => {
      const result = await appContextManager.generateContextMessage(mockContext);
      
      expect(result).toBeDefined();
      expect(result).toContain('Directory Structure:');
      
      // Should show some directories/files
      expect(result).toMatch(/├──|└──/); // Tree structure characters
    });

    it('should handle package.json parsing correctly', async () => {
      // Test the read file tool directly first
      console.log('\n🔍 Testing ReadFileTool directly...');
      const readFileTool = new (await import('../../tools/read-file.js')).ReadFileTool();
      const directResult = await readFileTool.readFile({ path: 'package.json' }, testAppPath);
      console.log('Direct ReadFileTool result:');
      console.log('- Success:', directResult.success);
      console.log('- Content type:', typeof directResult.content);
      console.log('- Content length:', directResult.content.length);
      console.log('- First 100 chars:', directResult.content.substring(0, 100));
      
      // Test the package info method directly
      const packageInfo = await appContextManager['getPackageInfo'](mockContext);
      
      expect(packageInfo).not.toBeNull();
      expect(packageInfo).toBeDefined();
      expect(packageInfo).toHaveProperty('name');
      expect(packageInfo).toHaveProperty('version');
      
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
      expect(result2).not.toContain('Package Information: Not available');
    });
  });

  describe('Error handling', () => {
    it('should handle non-existent app directory gracefully', async () => {
      const badContext = {
        ...mockContext,
        metadata: { appPath: '/non/existent/path' }
      };

      const result = await appContextManager.generateContextMessage(badContext);
      expect(result).toBeNull();
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