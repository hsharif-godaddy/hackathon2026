import type { AgentExecutionContext } from '../base/agent.interface.js';
import { executeToolFunction } from '../tools/tool-functions.js';

/**
 * Service for managing app context information that should be injected into LLM conversations
 * Provides comprehensive project context including:
 * - Directory structure (max depth 4, up to 100 lines)
 * - Package.json information (up to 50 main dependencies, scripts, project details)
 * - Dependency installation status (checks pnpm-lock.yaml vs package.json timestamps with 5s tolerance for WSL2)
 */
export class AppContextManager {
  
  /**
   * Generate context message that provides directory listing and package information to the LLM
   * @param context - The agent execution context containing app metadata
   * @returns Promise<string | null> - Formatted context message or null if no context needed
   */
  async generateContextMessage(context: AgentExecutionContext): Promise<string | null> {
    try {
      // Only generate context if we have an app context
      if (!context.metadata?.appId) {
        return null;
      }

      // Get directory listing with max depth of 4
      const directoryListing = await executeToolFunction('directory_listing', {
        path: '',
        maxDepth: 4,
        showHidden: false,
        directoriesOnly: false
      }, context);

      if (!directoryListing || typeof directoryListing !== 'string') {
        return null;
      }

      // Get package.json information
      const packageInfo = await this.getPackageInfo(context);

      // Format both directory listing and package info into context message
      return this.formatAppContext(directoryListing, packageInfo);
      
    } catch (error) {
      console.warn('AppContextManager: Failed to generate context message:', error);
      return null;
    }
  }

  /**
   * Get package.json information including dependencies and installation status
   * @param context - The agent execution context
   * @returns Promise with package information or null if not available
   */
  private async getPackageInfo(context: AgentExecutionContext): Promise<{
    name?: string;
    version?: string;
    description?: string;
    dependencies: string[];
    scripts: string[];
    dependenciesInstalled: boolean;
  } | null> {
    let packageContent: unknown = null;
    
    try {
      // Try to read package.json using the read_file tool
      packageContent = await executeToolFunction('read_file', {
        path: 'package.json'
      }, context);

      if (!packageContent || typeof packageContent !== 'string') {
        console.warn('AppContextManager: package.json read returned unexpected type:', typeof packageContent);
        return null;
      }

      // The read_file tool returns formatted content with headers, extract just the JSON content
      // Format is: "File: path\nTotal lines: X\nFile size: Y bytes\n\n{actual content}"
      const lines = packageContent.split('\n');
      const contentStartIndex = lines.findIndex(line => line.trim() === '') + 1;
      const jsonContent = lines.slice(contentStartIndex).join('\n').trim();

      if (!jsonContent) {
        console.warn('AppContextManager: No JSON content found in package.json');
        return null;
      }

      const packageJson = JSON.parse(jsonContent);
      
      // Check if dependencies are installed by comparing lock file modification time
      const dependenciesInstalled = await this.checkDependenciesInstalled(context);
      
      return {
        name: packageJson.name,
        version: packageJson.version,
        description: packageJson.description,
        dependencies: Object.keys(packageJson.dependencies || {}),
        scripts: Object.keys(packageJson.scripts || {}),
        dependenciesInstalled
      };
    } catch (error) {
      console.warn('AppContextManager: Failed to read package.json:', error);
      if (typeof packageContent === 'string') {
        console.warn('AppContextManager: Raw package content preview:', packageContent.substring(0, 300));
      } else {
        console.warn('AppContextManager: Package content type:', typeof packageContent);
      }
      return null;
    }
  }

  /**
   * Check if dependencies are installed by comparing pnpm-lock.yaml and package.json modification times
   * Uses a 5-second tolerance window to account for WSL2 time inconsistencies
   * @param context - The agent execution context
   * @returns Promise<boolean> - true if dependencies appear to be installed
   */
  private async checkDependenciesInstalled(context: AgentExecutionContext): Promise<boolean> {
    try {
      // Get file stats for both package.json and pnpm-lock.yaml using directory listing
      const listing = await executeToolFunction('directory_listing', {
        path: '',
        maxDepth: 1,
        showHidden: false,
        directoriesOnly: false
      }, context);

      if (!listing || typeof listing !== 'string') {
        return false;
      }

      // Look for modification times in the directory listing
      // The directory listing should show file modification times
      const packageJsonMatch = listing.match(/package\.json.*?(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/);
      const pnpmLockMatch = listing.match(/pnpm-lock\.yaml.*?(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/);

      if (!packageJsonMatch || !pnpmLockMatch) {
        // If we can't find both files with timestamps, assume not installed
        return false;
      }

      const packageJsonTime = new Date(packageJsonMatch[1]!);
      const pnpmLockTime = new Date(pnpmLockMatch[1]!);

      // Calculate time difference in seconds
      const timeDiffSeconds = Math.abs(pnpmLockTime.getTime() - packageJsonTime.getTime()) / 1000;
      
      // If pnpm-lock.yaml is newer than package.json OR within 5 seconds (for WSL2 time inconsistencies)
      // consider dependencies installed
      const isInstalled = pnpmLockTime >= packageJsonTime || timeDiffSeconds <= 5;
      
      console.log(`AppContextManager: Package.json time: ${packageJsonTime.toISOString()}, pnpm-lock time: ${pnpmLockTime.toISOString()}, diff: ${timeDiffSeconds.toFixed(2)}s, installed: ${isInstalled}`);
      
      return isInstalled;
    } catch (error) {
      console.warn('AppContextManager: Failed to check dependency installation status:', error);
      return false;
    }
  }

  /**
   * Format directory listing and package info into a comprehensive context message
   * @param directoryListing - Raw directory listing output
   * @param packageInfo - Package information from package.json
   * @returns Formatted context message
   */
  private formatAppContext(directoryListing: string, packageInfo: any): string {
    const directorySection = this.formatDirectorySection(directoryListing);
    const packageSection = this.formatPackageSection(packageInfo);
    
    return `[Current Project Context]

${packageSection}

${directorySection}

Note: This is the current project context including dependencies and directory structure. You don't need to run additional directory listings unless you need to explore specific subdirectories in detail.`;
  }

  /**
   * Format directory listing into a compact section
   * @param directoryListing - Raw directory listing output
   * @returns Formatted directory section
   */
  private formatDirectorySection(directoryListing: string): string {
    // Clean up the directory listing - remove excessive whitespace and format for compactness
    const lines = directoryListing.split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    // Find the actual tree structure (skip any headers)
    const treeStartIndex = lines.findIndex(line => line.includes('├') || line.includes('└') || line.includes('│'));
    const treeLines = treeStartIndex >= 0 ? lines.slice(treeStartIndex) : lines;

    // Limit to reasonable number of lines for context
    const maxLines = 200;
    const limitedLines = treeLines.slice(0, maxLines);
    const truncated = treeLines.length > maxLines;

    const compactListing = limitedLines.join('\n');

    return `Directory Structure:
${compactListing}${truncated ? '\n... (truncated for brevity)' : ''}`;
  }

  /**
   * Format package.json information into a compact section
   * @param packageInfo - Package information or null
   * @returns Formatted package section
   */
  private formatPackageSection(packageInfo: any): string {
    if (!packageInfo) {
      return 'Package Information: Not available';
    }

    const sections = [];
    
    // Basic project info
    if (packageInfo.name || packageInfo.version || packageInfo.description) {
      const basicInfo = [];
      if (packageInfo.name) basicInfo.push(`Name: ${packageInfo.name}`);
      if (packageInfo.version) basicInfo.push(`Version: ${packageInfo.version}`);
      if (packageInfo.description) basicInfo.push(`Description: ${packageInfo.description}`);
      sections.push(`Project: ${basicInfo.join(', ')}`);
    }

    // Dependencies (up to 50 main dependencies)
    if (packageInfo.dependencies && packageInfo.dependencies.length > 0) {
      const deps = packageInfo.dependencies.slice(0, 50); // Limit to first 50
      const truncated = packageInfo.dependencies.length > 50;
      sections.push(`Dependencies: ${deps.join(', ')}${truncated ? ` (+${packageInfo.dependencies.length - 50} more)` : ''}`);
    }

    // Installation status
    if (typeof packageInfo.dependenciesInstalled === 'boolean') {
      sections.push(`Installation Status: ${packageInfo.dependenciesInstalled ? 'All dependencies are installed' : 'Dependencies may need installation'}`);
    }

    // Available scripts
    if (packageInfo.scripts && packageInfo.scripts.length > 0) {
      sections.push(`Scripts: ${packageInfo.scripts.join(', ')}`);
    }

    return sections.length > 0 ? sections.join('\n') : 'Package Information: No details available';
  }
}
