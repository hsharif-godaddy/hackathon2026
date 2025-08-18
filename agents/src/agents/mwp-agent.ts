import { BaseAgent } from '../base/index.js';
import type { 
  AgentConfig, 
  AgentToolConfig, 
  AgentContextConfig,
  AgentExecutionContext 
} from '../base/index.js';

/**
 * Managed WordPress Agent - helps users manage WordPress sites
 */
export class MWPAgent extends BaseAgent {
  constructor() {
    const config: AgentConfig = {
      id: 'mwp-agent',
      name: 'Managed WordPress Assistant',
      description: 'Helps users manage WordPress sites with a focus on safe operations and verification',
      model: 'gpt-4',
      tools: [
        { name: 'list_mwp_sites', description: 'List all managed WordPress sites', required: true },
        { name: 'get_mwp_site_details', description: 'Get detailed information about a specific site' },
        { name: 'list_mwp_plan_upgrades', description: 'List available plan upgrades for a site' },
        { name: 'get_mwp_staging_site_details', description: 'Get staging site details' },
        { name: 'get_available_php_versions', description: 'Get available PHP versions' },
        { name: 'change_mwp_php_version', description: 'Change PHP version (destructive operation)' },
        { name: 'change_mwp_wp_version', description: 'Change WordPress version (destructive operation)' },
        { name: 'get_available_wp_versions', description: 'Get available WordPress versions' },
        { name: 'change_rum', description: 'Change RUM settings (destructive operation)' },
        { name: 'create_staging_site', description: 'Create a staging site' },
        { name: 'flush_mwp_cdn', description: 'Flush CDN cache (destructive operation)' },
        { name: 'generate_sftp_credentials', description: 'Generate SFTP credentials' },
        { name: 'view_database_details', description: 'View database connection details' },
        { name: 'view_website_metrics', description: 'View website performance metrics' },
        { name: 'check_url_status', description: 'Check if a URL is accessible', required: true },
        { name: 'remove_production_site', description: 'Remove production site (destructive operation)' },
        { name: 'remove_staging_site', description: 'Remove staging site (destructive operation)' },
        { name: 'view_plan_limits', description: 'View current plan limits' },
        { name: 'get_ssh_connection_details', description: 'Get SSH connection information' },
        { name: 'sync_prod_to_staging', description: 'Sync production to staging' },
        { name: 'sync_staging_to_prod', description: 'Sync staging to production (destructive operation)' },
        { name: 'mwp_cart_upgrade', description: 'Upgrade plan via cart' },
        { name: 'reset_file_permissions', description: 'Reset file permissions (destructive operation)' },
      ],
      contextBuilder: {
        tools: ['list_mwp_sites'],
        skipContextBuilding: false,
      },
      handoffs: [],
      version: '1.0.0',
      tags: ['wordpress', 'hosting', 'website-management'],
    };

    super(config);
  }

  /**
   * Custom validation for MWP agent
   */
  protected async customValidation(): Promise<void> {
    // Ensure required tools are available
    const requiredTools = this.getTools().filter(tool => tool.required);
    if (requiredTools.length === 0) {
      throw new Error('MWP agent must have at least one required tool');
    }

    // Validate that we have URL checking capability for verification
    const hasUrlCheck = this.getTools().some(tool => tool.name === 'check_url_status');
    if (!hasUrlCheck) {
      throw new Error('MWP agent requires check_url_status tool for verification workflows');
    }
  }

  /**
   * Customize system prompt based on execution context
   */
  protected customizeSystemPrompt(
    basePrompt: string, 
    context?: AgentExecutionContext
  ): string {
    let customizedPrompt = basePrompt;

    // Add contextual information if available
    if (context?.metadata?.userTier) {
      customizedPrompt += `\n\n**USER CONTEXT:**\nUser Tier: ${context.metadata.userTier}`;
    }

    if (context?.metadata?.supportLevel) {
      customizedPrompt += `\nSupport Level: ${context.metadata.supportLevel}`;
    }

    // Add timestamp for reference
    if (context?.timestamp) {
      customizedPrompt += `\n\nCurrent time: ${context.timestamp.toISOString()}`;
    }

    return customizedPrompt;
  }

  /**
   * Custom initialization for MWP agent
   */
  protected async customInitialization(): Promise<void> {
    console.log('Initializing MWP Agent...');
    
    // Perform any MWP-specific setup here
    // For example, validate environment variables, check API endpoints, etc.
    
    console.log('MWP Agent initialized successfully');
  }

  /**
   * Before tool execution hook - add verification for destructive operations
   */
  async beforeToolExecution(toolName: string, args: unknown): Promise<unknown> {
    const destructiveOperations = [
      'change_mwp_php_version',
      'change_mwp_wp_version', 
      'change_rum',
      'flush_mwp_cdn',
      'reset_file_permissions',
      'remove_production_site',
      'remove_staging_site',
      'sync_staging_to_prod',
    ];

    if (destructiveOperations.includes(toolName)) {
      console.log(`⚠️  Preparing to execute destructive operation: ${toolName}`);
      
      // Add any pre-execution validation here
      // For example, check if the site is in a valid state
    }

    return args;
  }

  /**
   * After tool execution hook - add verification for destructive operations
   */
  async afterToolExecution(
    toolName: string, 
    args: unknown, 
    result: unknown
  ): Promise<unknown> {
    const destructiveOperations = [
      'change_mwp_php_version',
      'change_mwp_wp_version',
      'change_rum', 
      'flush_mwp_cdn',
      'reset_file_permissions',
      'sync_staging_to_prod',
    ];

    if (destructiveOperations.includes(toolName)) {
      console.log(`✅ Completed destructive operation: ${toolName}`);
      console.log('💡 Remember to verify the site is still accessible using check_url_status');
    }

    return result;
  }
}
