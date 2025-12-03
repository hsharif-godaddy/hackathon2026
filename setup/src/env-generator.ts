import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import { CertConfigSetup } from "./cert-config";
import { GettyConfigSetup } from "./getty-config.js";
import { CommerceConfigSetup } from "./commerce-config.js";
import { AWSSSoSetup } from "./aws-sso.js";

export interface CommerceSetupResult {
	success: boolean;
	agentsEnvConfig?: string;
	appEnvConfig?: string;
}

export interface ModelConfig {
	provider: "aws-bedrock" | "gocode";
	awsRegion?: string;
	awsProfile?: string;
	gocodeApiKey?: string;
	gocodeBaseUrl?: string;
}

export interface AuthConfig {
	authType: "none" | "mock" | "jwt";
	// Deprecated - maintained for backward compatibility
	useMockLogin?: boolean;
	authRealm?: string;
	authRisk?: string;
}

export interface AppEnvConfig {
	nodeEnv: string;
	databaseUrl: string;
	modelConfig: ModelConfig;
	authConfig: AuthConfig;
	awsProfile?: string;
	port: number;
	httpsPort: number;
}

export interface AgentsEnvConfig {
	nodeEnv: string;
	appTemplateDir: string;
	showUsageCost: boolean;
	modelConfig: ModelConfig;
	authType: "none" | "mock" | "jwt";
	mysqlRootHost: string;
	mysqlRootPort: number;
	mysqlRootUser: string;
	mysqlRootPass: string;
	ssoJwt?: string;
}

export class EnvGenerator {
	private projectRoot: string;
	private static readonly DEFAULT_DATABASE_URL =
		"mysql://airo:airopassword@localhost:3306/airo_app?sslaccept=accept_invalid_certs";
	private awsSSO: AWSSSoSetup;

	constructor(projectRoot: string) {
		this.projectRoot = projectRoot;
		this.awsSSO = new AWSSSoSetup();
	}

	private async checkExistingAWSProfile(): Promise<string | null> {
		try {
			const { execa } = await import("execa");

			// First check if the SSO profile exists and is logged in
			const ssoProfileName = await this.awsSSO.getProfile();
			try {
				await execa('aws', [
					'sts', 'get-caller-identity',
					'--profile', ssoProfileName,
					'--query', 'Arn',
					'--output', 'text'
				]);
				return ssoProfileName;
			} catch {
				// SSO profile exists but not logged in or doesn't work
			}

			// Check if any default credentials work
			try {
				await execa('aws', [
					'sts', 'get-caller-identity',
					'--query', 'Arn',
					'--output', 'text'
				]);
				return process.env.AWS_PROFILE || 'default';
			} catch {
				// No working default credentials
			}

			return null;
		} catch {
			return null;
		}
	}

	async promptModelProvider(): Promise<ModelConfig> {
		console.log(chalk.cyan("\n🤖 AI Model Configuration"));

		const { provider } = await inquirer.prompt([
			{
				type: "list",
				name: "provider",
				message: "Which AI model provider would you like to use?",
				choices: [
					{ name: "GoCode (Recommended)", value: "gocode" },
					{ name: "AWS Bedrock (Legacy)", value: "aws-bedrock" },
				],
			},
		]);

		if (provider === "aws-bedrock") {
			return await this.promptAWSBedrockConfig();
		} else {
			return await this.promptGoCodeConfig();
		}
	}

	private async promptAWSBedrockConfig(): Promise<ModelConfig> {
		console.log(chalk.yellow("\n🔧 AWS Bedrock Configuration"));
		console.log("You'll need AWS credentials with Bedrock access.");
		console.log("");

		// Check if AWS SSO profile already exists
		const currentProfile = await this.checkExistingAWSProfile();
		if (currentProfile) {
			const { useExistingProfile } = await inquirer.prompt([
				{
					type: "confirm",
					name: "useExistingProfile",
					message: `Use existing AWS profile '${currentProfile}' for Bedrock?`,
					default: true,
				},
			]);

			if (useExistingProfile) {
				const { awsRegion } = await inquirer.prompt([
					{
						type: "input",
						name: "awsRegion",
						message: "AWS Region (e.g., us-west-2):",
						default: "us-west-2",
						validate: (input) => input.length > 0 || "AWS Region is required",
					},
				]);

				return {
					provider: "aws-bedrock",
					awsRegion,
					awsProfile: currentProfile,
				};
			}
		}

		// Prompt to set up AWS SSO
		const { setupSSO } = await inquirer.prompt([
			{
				type: "list",
				name: "setupSSO",
				message: "How would you like to configure AWS credentials?",
				choices: [
					{ name: "Set up AWS SSO profile (recommended)", value: "sso" },
					{ name: "Use existing AWS credentials/profile", value: "existing" },
				],
				default: "sso",
			},
		]);

		if (setupSSO === "sso") {
			console.log(chalk.blue("\n🔧 Setting up AWS SSO for Bedrock access..."));
			const ssoSuccess = await this.awsSSO.setup();

			if (ssoSuccess) {
				const profileName = await this.awsSSO.getProfile();
				const { awsRegion } = await inquirer.prompt([
					{
						type: "input",
						name: "awsRegion",
						message: "AWS Region (e.g., us-west-2):",
						default: "us-west-2",
						validate: (input) => input.length > 0 || "AWS Region is required",
					},
				]);

				return {
					provider: "aws-bedrock",
					awsRegion,
					awsProfile: profileName,
				};
			} else {
				console.log(chalk.red("❌ AWS SSO setup failed. Falling back to existing profile selection."));
			}
		}

		// Fallback to selecting existing profile or default
		const { awsProfile, awsRegion } = await inquirer.prompt([
			{
				type: "input",
				name: "awsProfile",
				message: "AWS Profile name (leave empty for default):",
				default: "",
			},
			{
				type: "input",
				name: "awsRegion",
				message: "AWS Region (e.g., us-west-2):",
				default: "us-west-2",
				validate: (input) => input.length > 0 || "AWS Region is required",
			},
		]);

		return {
			provider: "aws-bedrock",
			awsRegion,
			awsProfile: awsProfile || undefined,
		};
	}

	private async promptGoCodeConfig(): Promise<ModelConfig> {
		console.log(chalk.yellow("\n🔧 GoCode Configuration"));

		const answers = await inquirer.prompt([
			{
				type: "input",
				name: "gocodeBaseUrl",
				message: "GoCode Base URL:",
				default: "https://caas-gocode-prod.caas-prod.prod.onkatana.net",
				validate: (input) => {
					try {
						new URL(input);
						return true;
					} catch {
						return "Please enter a valid URL";
					}
				},
			},
			{
				type: "password",
				name: "gocodeApiKey",
				message: "GoCode API Key:",
				validate: (input) => input.length > 0 || "GoCode API Key is required",
			},
		]);

		return {
			provider: "gocode",
			...answers,
		};
	}

	async promptAuthConfig(): Promise<AuthConfig> {
		console.log(chalk.cyan("\n🔐 Authentication Configuration"));
		console.log(chalk.gray("Choose the authentication type for your development environment:"));

		const { authType } = await inquirer.prompt([
			{
				type: "list",
				name: "authType",
				message: "Which authentication type would you like to use?",
				choices: [
					{
						name: "JWT - Full authentication with SSO (Recommended for proper local development)",
						value: "jwt",
						short: "JWT"
					},
					{
						name: "None - No authentication (Some UI functionalities will be degraded)",
						value: "none",
						short: "None"
					},
				],
				default: "jwt",
			},
		]);

		if (authType === "jwt") {
			return await this.promptSSOConfig();
		} else {
			return {
				authType: authType as "none" | "jwt",
				// Set legacy flag for backward compatibility
				useMockLogin: false
			};
		}
	}

	async promptAppAwsProfile(): Promise<string | undefined> {
		console.log(chalk.cyan("\n☁️  AWS Profile Configuration"));
		console.log(chalk.gray("The app requires an AWS profile for various AWS service integrations."));

		const currentProfile = await this.checkExistingAWSProfile();

		if (currentProfile) {
			const { useExistingProfile } = await inquirer.prompt([
				{
					type: "confirm",
					name: "useExistingProfile",
					message: `Use existing AWS profile '${currentProfile}' for the app?`,
					default: true,
				},
			]);

			if (useExistingProfile) {
				return currentProfile;
			}
		}

		const { setupSSO } = await inquirer.prompt([
			{
				type: "list",
				name: "setupSSO",
				message: "How would you like to configure AWS credentials for the app?",
				choices: [
					{ name: "Set up AWS SSO profile (recommended)", value: "sso" },
					{ name: "Use existing AWS credentials/profile", value: "existing" },
					{ name: "Skip AWS profile configuration", value: "skip" },
				],
				default: "sso",
			},
		]);

		if (setupSSO === "skip") {
			return undefined;
		}

		if (setupSSO === "sso") {
			console.log(chalk.blue("\n🔧 Setting up AWS SSO for the app..."));
			const ssoSuccess = await this.awsSSO.setup();

			if (ssoSuccess) {
				return await this.awsSSO.getProfile();
			} else {
				console.log(chalk.red("❌ AWS SSO setup failed. Falling back to manual profile entry."));
			}
		}

		const { awsProfile } = await inquirer.prompt([
			{
				type: "input",
				name: "awsProfile",
				message: "AWS Profile name (leave empty to skip):",
				default: "",
			},
		]);

		return awsProfile || undefined;
	}

	private async promptSSOConfig(): Promise<AuthConfig> {
		console.log(chalk.yellow("\n🔧 SSO Configuration"));
		console.log(chalk.gray("SSO URLs are configured per environment in .env.local.{dev|test|prod} files"));
		console.log(chalk.gray("These base settings apply when no environment-specific config is loaded\n"));

		const answers = await inquirer.prompt([
			{
				type: "input",
				name: "authRealm",
				message: "Auth Realm:",
				default: "idp",
				validate: (input) => input.length > 0 || "Auth Realm is required",
			},
			{
				type: "list",
				name: "authRisk",
				message: "Auth Risk Level:",
				choices: ["low", "medium", "high"],
				default: "low",
			},
		]);

		return {
			authType: "jwt",
			useMockLogin: false,
			...answers,
		};
	}

	generateAppEnvContent(config: AppEnvConfig, certSetup?: string, commerceConfig?: string): string {
		// Use airo user with enhanced privileges for Prisma migrations
		// The MySQL container grants necessary CREATE/ALTER/DROP privileges to this user

		let envContent = `# Airo App Builder - App Environment Configuration
# Generated by setup utility

# Environment
NODE_ENV=${config.nodeEnv}
PORT=${config.port}
HTTPS_PORT=${config.httpsPort}

# Database Configuration (MySQL via Docker)
# The 'airo' user has enhanced privileges for Prisma migrations
DATABASE_URL=${config.databaseUrl}

# AWS Configuration
`;

		if (config.awsProfile) {
			envContent += `AWS_PROFILE=${config.awsProfile}
`;
		} else {
			envContent += `# AWS_PROFILE=<your-aws-profile>
`;
		}

		envContent += `
# AI Model Configuration
`;

		if (config.modelConfig.provider === "aws-bedrock") {
			envContent += `# AWS Bedrock Configuration
AI_PROVIDER=aws-bedrock
AWS_REGION=${config.modelConfig.awsRegion}
BEDROCK_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0
`;
		} else {
			envContent += `# GoCode Configuration
AI_PROVIDER=gocode
GOCODE_BASE_URL=${config.modelConfig.gocodeBaseUrl}
GOCODE_API_KEY=${config.modelConfig.gocodeApiKey}
`;
		}

		envContent += `
# Application Features
SHOW_USAGE_COST=true

# Authentication Configuration
AUTH_TYPE=${config.authConfig.authType}
`;

		// Note: SSO URLs are now in environment-specific .env.local.{dev|test|prod} files
		// No need to add them to the base .env file

		// Add legacy compatibility flags (deprecated but maintained for compatibility)
		envContent += `
# Legacy Authentication Settings (DEPRECATED - Use AUTH_TYPE instead)
# These are maintained for backward compatibility
NEXT_PUBLIC_USE_MOCK_LOGIN=${config.authConfig.authType === "mock" ? "true" : "false"}

# Note: SSO_LOGIN_URL and SSO_LOGOUT_URL are configured per environment
# See .env.local.dev, .env.local.test, and .env.local.prod files
`;

    if (certSetup) {
      envContent += certSetup;
    }

		// Add Commerce configuration if provided
		if (commerceConfig) {
			envContent += commerceConfig;
		} else {
			envContent += `

# GoDaddy Commerce Configuration (Not configured - run setup again to configure)
# GODADDY_OAUTH_CLIENT_ID=c16c68eb-0c20-437c-90bd-1c78911b3d48
# GODADDY_OAUTH_CLIENT_SECRET=<client_secret_from_aws_secrets_manager>
# GODADDY_API_BASE_URL=https://api.dev-godaddy.com
`;
		}

		return envContent;
	}

	/**
	 * Generate environment-specific configuration files
	 * Creates .env.local.dev, .env.local.test, and .env.local.prod
	 * These files are used by the load-env.js script to load the correct config per GASKET_ENV
	 */
	generateEnvLocalContent(env: 'dev' | 'test' | 'prod', config: AppEnvConfig): string {
		const envConfigs = {
			dev: {
				ssoLoginUrl: 'https://sso.dev-godaddy.com/login',
				ssoLogoutUrl: 'https://sso.dev-godaddy.com/logout',
				loginRedirectUrl: 'https://local.gasket.dev-godaddy.com:8443/',
				agentsServiceUrl: 'http://localhost:4000',
				awsRegion: config.modelConfig.awsRegion || 'us-west-2',
			},
			test: {
				ssoLoginUrl: 'https://sso.test-godaddy.com/login',
				ssoLogoutUrl: 'https://sso.test-godaddy.com/logout',
				loginRedirectUrl: 'https://airo-builder.test-godaddy.com:8443/',
				agentsServiceUrl: 'http://localhost:4000',
				awsRegion: config.modelConfig.awsRegion || 'us-west-2',
			},
			prod: {
				ssoLoginUrl: 'https://sso.godaddy.com/login',
				ssoLogoutUrl: 'https://sso.godaddy.com/logout',
				loginRedirectUrl: 'https://airo-builder.godaddy.com:8443/',
				agentsServiceUrl: 'http://localhost:4000',
				awsRegion: config.modelConfig.awsRegion || 'us-west-2',
			},
		};

		const envConfig = envConfigs[env];
		const envName = env.charAt(0).toUpperCase() + env.slice(1);

		let content = `# Airo App Builder - ${envName} Environment Configuration
# Generated by setup utility
# This file is loaded when GASKET_ENV=local.${env}

# SSO Configuration
SSO_LOGIN_URL=${envConfig.ssoLoginUrl}
SSO_LOGOUT_URL=${envConfig.ssoLogoutUrl}
LOGIN_REDIRECT_URL=${envConfig.loginRedirectUrl}

# Agents Service (Legacy Control Plane)
# For V2 control plane, agents run remotely
AGENTS_SERVICE_URL=${envConfig.agentsServiceUrl}

# AWS Configuration
AWS_REGION=${envConfig.awsRegion}
`;

		// Add management API base URL for test/prod
		if (env === 'test' || env === 'prod') {
			const mgmtUrl = env === 'test' ? 'https://mgmt.nstk.net' : 'https://mgmt.woosaas.godaddy.com';
			content += `
# Management API Base URL used for V2 control plane when USE_V2_CONTROL_PLANE is true
MGMT_AIRO_BASE_URL=${mgmtUrl}

# V2 Control Plane Configuration (optional)
# Uncomment to use V2 control plane instead of legacy
# USE_V2_CONTROL_PLANE=true
`;
		}

		// Add JWT secrets config for prod
		if (env === 'prod') {
			content += `
# JWT Configuration for Production V2
# Required for local:prod:v2 (V2 control plane with remote prod agents)
#
# To enable local:prod:v2, uncomment these lines:
# 1. Set your production AWS profile (required to fetch JWT keys from Secrets Manager)
# AWS_PROFILE=gd-aws-usa-gd-airobuilde-prod
#
# 2. Specify the production JWT secrets name
# JWT_SECRETS_NAME=prod-airo-jwt-keys
#
# The app will automatically fetch the JWT keys from AWS Secrets Manager
# and use them to sign tokens that prod V2 agents will accept.
`;
		}

		return content;
	}

	generateAgentsEnvContent(config: AgentsEnvConfig, gettyConfig?: string, commerceConfig?: string): string {
		let envContent = `# Airo App Builder - Agents Environment Configuration
# Generated by setup utility

# Environment
NODE_ENV=${config.nodeEnv}

APP_TEMPLATE_DIR='${config.appTemplateDir}'
SHOW_USAGE_COST=${config.showUsageCost}

# AI Model Configuration
`;

		if (config.modelConfig.provider === "aws-bedrock") {
			envContent += `# AWS Bedrock Configuration
OPENAI_API_KEY=""
OPENAI_BASE_URL=""
OPENAI_MODEL="anthropic.claude-3-sonnet-20240229-v1:0"

# AWS Configuration
AWS_REGION=${config.modelConfig.awsRegion}`;

			if (config.modelConfig.awsProfile) {
				envContent += `
AWS_PROFILE=${config.modelConfig.awsProfile}`;
			}

			envContent += `
`;
		} else {
			envContent += `# GoCode Configuration (Anthropic API compatibility)
DEFAULT_PROVIDER="anthropic"
OPENAI_API_KEY="${config.modelConfig.gocodeApiKey}"
OPENAI_BASE_URL="${config.modelConfig.gocodeBaseUrl}"
ANTHROPIC_API_KEY="${config.modelConfig.gocodeApiKey}"
ANTHROPIC_BASE_URL="${config.modelConfig.gocodeBaseUrl}"
ANTHROPIC_MODEL="claude-sonnet-4"
`;
		}

		envContent += `
# Authentication Configuration
AUTH_TYPE=${config.authType}

# Legacy Authentication Setting (DEPRECATED - Use AUTH_TYPE instead)
BYPASS_AUTH_FOR_LOCAL=${config.authType === "none" ? "true" : "false"}

# MySQL configuration (for app databases, not agent storage)
MYSQL_ROOT_HOST=${config.mysqlRootHost}
MYSQL_ROOT_PORT=${config.mysqlRootPort}
MYSQL_ROOT_USER=${config.mysqlRootUser}
MYSQL_ROOT_PASS=${config.mysqlRootPass}
`;

		// Add Getty configuration if provided
		if (gettyConfig) {
			envContent += gettyConfig;
		} else if (config.ssoJwt) {
			envContent += `
# Required for Getty Images (Legacy SSO JWT)
SSO_JWT=${config.ssoJwt}
`;
		} else {
			envContent += `
# Getty Images Configuration (Not configured - run setup again to configure)
# GETTY_API_URL=https://airobuilde-proxy-dev-private-ecs.airobuilde-dev-private.prod.onkatana.net
# GETTY_TOKEN=<your-token>
# IMAGE_SEARCH_DRIVER=getty
`;
		}

		// Add Commerce configuration if provided
		if (commerceConfig) {
			envContent += commerceConfig;
		} else {
			envContent += `

# GoDaddy Commerce Configuration (Not configured - run setup again to configure)
# GODADDY_OAUTH_CLIENT_ID=c16c68eb-0c20-437c-90bd-1c78911b3d48
# GODADDY_OAUTH_CLIENT_SECRET=<client_secret_from_aws_secrets_manager>
# GODADDY_OAUTH_ENCRYPTION_KEY=<encryption_key_from_aws_secrets_manager>
# GODADDY_API_BASE_URL=https://api.dev-godaddy.com
# AGENT_URL=http://localhost:4000
ENABLE_COMMERCE_AGENT=false
`;
		}

		return envContent;
	}

	async generateAppEnv(promptForCommerce: boolean = true, commerceResult: CommerceSetupResult | null = null): Promise<void> {
		console.log(chalk.cyan("\n📝 Generating App Environment Configuration"));

		const modelConfig = await this.promptModelProvider();
		const authConfig = await this.promptAuthConfig();
		const awsProfile = await this.promptAppAwsProfile();

		const config: AppEnvConfig = {
			nodeEnv: "development",
			databaseUrl: EnvGenerator.DEFAULT_DATABASE_URL,
			modelConfig,
			authConfig,
			awsProfile,
			port: 3000,
			httpsPort: 8443,
		};

    const certSetup = new CertConfigSetup();
    const result = await certSetup.setup();

		// Commerce Configuration
		let commerceAppConfig: string | undefined;

		// Use provided Commerce result from full setup, or prompt if in selective mode
		if (commerceResult && commerceResult.appEnvConfig) {
			commerceAppConfig = commerceResult.appEnvConfig;
		} else if (promptForCommerce) {
			console.log(chalk.cyan("\n🛒 GoDaddy Commerce Configuration"));

			const { configureCommerce } = await inquirer.prompt([
				{
					type: "confirm",
					name: "configureCommerce",
					message: "Would you like to enable and configure GoDaddy Commerce?",
					default: true
				}
			]);

			if (configureCommerce) {
				const commerceSetup = new CommerceConfigSetup();
				const localCommerceResult = await commerceSetup.setup();

				if (localCommerceResult.success && localCommerceResult.appEnvConfig) {
					commerceAppConfig = localCommerceResult.appEnvConfig;
				} else {
					console.log(chalk.yellow("Commerce configuration failed, skipping..."));
				}
			}
		}

		const envContent = this.generateAppEnvContent(
			config,
			result.success ? result.envConfig : undefined,
			commerceAppConfig
		);
		const appEnvPath = path.join(this.projectRoot, "app", ".env");

		// Check if .env already exists
		if (await fs.pathExists(appEnvPath)) {
			const { overwrite } = await inquirer.prompt([
				{
					type: "confirm",
					name: "overwrite",
					message: `App .env file already exists. Overwrite it?`,
					default: false,
				},
			]);

			if (!overwrite) {
				console.log(chalk.yellow("⏭  Skipping app .env generation"));
				return;
			}
		}

		await fs.writeFile(appEnvPath, envContent);
		console.log(chalk.green(`✅ Generated app .env file: ${appEnvPath}`));

		// Generate environment-specific .env.local.* files
		console.log(chalk.cyan("\nGenerating environment-specific configuration files..."));
		
		const environments: Array<'dev' | 'test' | 'prod'> = ['dev', 'test', 'prod'];
		const generatedFiles: string[] = [];

		for (const env of environments) {
			const envLocalContent = this.generateEnvLocalContent(env, config);
			const envLocalPath = path.join(this.projectRoot, "app", `.env.local.${env}`);
			
			// Always generate these files
			await fs.writeFile(envLocalPath, envLocalContent);
			generatedFiles.push(`.env.local.${env}`);
			console.log(chalk.green(`   Generated .env.local.${env}`));
		}

		// Show summary
		console.log(chalk.cyan("\n📋 Configuration Summary:"));
		console.log(`Database: MySQL (Docker container)`);
		console.log(`AI Provider: ${config.modelConfig.provider}`);
		if (config.modelConfig.provider === "aws-bedrock") {
			console.log(`AWS Region: ${config.modelConfig.awsRegion}`);
		}
		console.log(`AWS Profile: ${config.awsProfile || 'not configured'}`);
		console.log(
			`Authentication: AUTH_TYPE=${config.authConfig.authType}`,
		);
		console.log(`App HTTP Port: ${config.port}`);
		console.log(`App HTTPS Port: ${config.httpsPort}`);
		console.log(`Environment Files: ${generatedFiles.join(', ')}`);

		console.log(chalk.cyan("\n Environment Usage:"));
		console.log(`   ${chalk.blue('pnpm run dev')}         → Uses .env.local.dev (dev SSO)`);
		console.log(`   ${chalk.blue('pnpm run local:test')}  → Uses .env.local.test (test SSO)`);
		console.log(`   ${chalk.blue('pnpm run local:prod')}  → Uses .env.local.prod (prod SSO)`);
		console.log(`\n   See GETTING_STARTED.md for more details on running different environments.`);
	}

	async generateAgentsEnv(promptForCommerce: boolean = true, commerceResult: CommerceSetupResult | null = null): Promise<void> {
		console.log(chalk.cyan("\n📝 Generating Agents Environment Configuration"));

		const modelConfig = await this.promptModelProvider();

		// Prompt for MySQL configuration
		console.log(chalk.cyan("\n🗄 MySQL Configuration (for app databases)"));
		const mysqlConfig = await inquirer.prompt([
			{
				type: "input",
				name: "mysqlRootHost",
				message: "MySQL Root Host:",
				default: "localhost",
				validate: (input) => input.length > 0 || "MySQL Root Host is required",
			},
			{
				type: "input",
				name: "mysqlRootPort",
				message: "MySQL Root Port:",
				default: "3306",
				validate: (input) => {
					const port = parseInt(input, 10);
					return (
						(port > 0 && port < 65536) ||
						"Please enter a valid port number (1-65535)"
					);
				},
			},
			{
				type: "input",
				name: "mysqlRootUser",
				message: "MySQL Root User:",
				default: "root",
				validate: (input) => input.length > 0 || "MySQL Root User is required",
			},
			{
				type: "password",
				name: "mysqlRootPass",
				message: "MySQL Root Password (leave empty for no password):",
				default: "",
			},
		]);

		// Getty Images Configuration
		console.log(chalk.cyan("\n🖼️  Getty Images Configuration"));

		const { configureGetty } = await inquirer.prompt([
			{
				type: "list",
				name: "configureGetty",
				message: "How would you like to configure Getty Images?",
				choices: [
					{ name: "Use AWS proxy with token from Secrets Manager (recommended)", value: "aws-proxy" },
					{ name: "Use legacy SSO JWT token", value: "legacy-sso" },
					{ name: "Skip Getty configuration", value: "skip" }
				],
				default: "aws-proxy"
			}
		]);

		let gettyConfig: string | undefined;
		let ssoJwt: string | undefined;

		if (configureGetty === "aws-proxy") {
			// Use Getty proxy setup
			const gettySetup = new GettyConfigSetup();
			const result = await gettySetup.setup();

			if (result.success && result.envConfig) {
				gettyConfig = result.envConfig;
			} else {
				console.log(chalk.yellow("Getty AWS proxy configuration failed, falling back to legacy SSO method..."));
				// Fall back to legacy SSO method
				const legacySsoResult = await this.handleLegacySSO();
				ssoJwt = legacySsoResult || undefined;
			}
		}

		if (configureGetty === "legacy-sso") {
			ssoJwt = (await this.handleLegacySSO()) || undefined;
		}

		// Commerce Configuration
		let commerceAgentsConfig: string | undefined;

		// Use provided Commerce result from full setup, or prompt if in selective mode
		if (commerceResult && commerceResult.agentsEnvConfig) {
			commerceAgentsConfig = commerceResult.agentsEnvConfig;
		} else if (promptForCommerce) {
			console.log(chalk.cyan("\n🛒 GoDaddy Commerce Configuration"));

			const { configureCommerce } = await inquirer.prompt([
				{
					type: "confirm",
					name: "configureCommerce",
					message: "Would you like to enable and configure GoDaddy Commerce?",
					default: true
				}
			]);

			if (configureCommerce) {
				const commerceSetup = new CommerceConfigSetup();
				const localCommerceResult = await commerceSetup.setup();

				if (localCommerceResult.success && localCommerceResult.agentsEnvConfig) {
					commerceAgentsConfig = localCommerceResult.agentsEnvConfig;
				} else {
					console.log(chalk.yellow("Commerce configuration failed, skipping..."));
				}
			}
		}

		const config: AgentsEnvConfig = {
			nodeEnv: "development",
			appTemplateDir: "app-templates/v8",
			showUsageCost: true,
			modelConfig,
			authType: "none", // Default to no auth for agents service in development
			mysqlRootHost: mysqlConfig.mysqlRootHost,
			mysqlRootPort: parseInt(mysqlConfig.mysqlRootPort, 10),
			mysqlRootUser: mysqlConfig.mysqlRootUser,
			mysqlRootPass: mysqlConfig.mysqlRootPass,
			ssoJwt,
		};

		const envContent = this.generateAgentsEnvContent(config, gettyConfig, commerceAgentsConfig);
		const agentsEnvPath = path.join(this.projectRoot, "agents", ".env");

		// Check if .env already exists
		if (await fs.pathExists(agentsEnvPath)) {
			const { overwrite } = await inquirer.prompt([
				{
					type: "confirm",
					name: "overwrite",
					message: `Agents .env file already exists. Overwrite it?`,
					default: false,
				},
			]);

			if (!overwrite) {
				console.log(chalk.yellow("⏭  Skipping agents .env generation"));
				return;
			}
		}

		await fs.writeFile(agentsEnvPath, envContent);
		console.log(chalk.green(`✅ Generated agents .env file: ${agentsEnvPath}`));

		// Show summary
		console.log(chalk.cyan("\n📋 Configuration Summary:"));
		console.log(`AI Provider: ${config.modelConfig.provider}`);
		if (config.modelConfig.provider === "aws-bedrock") {
			console.log(`AWS Region: ${config.modelConfig.awsRegion}`);
			console.log(`AWS Profile: ${config.modelConfig.awsProfile || 'default'}`);
		}
		console.log(`Template Directory: ${config.appTemplateDir}`);
		console.log(`MySQL Host: ${config.mysqlRootHost}:${config.mysqlRootPort}`);
		console.log(`MySQL User: ${config.mysqlRootUser}`);

		let gettyStatus = "Not configured";
		if (gettyConfig) {
			gettyStatus = "AWS Proxy configured";
		} else if (ssoJwt) {
			gettyStatus = "Legacy SSO JWT configured";
		}
		console.log(`Getty Images: ${gettyStatus}`);
	}

	async checkMySQLConnection(): Promise<boolean> {
		console.log(chalk.blue("🔍 Checking MySQL container availability..."));

		try {
			const { execa } = await import("execa");
			const { stdout } = await execa('docker', [
				'ps',
				'--filter', 'name=airo-app-mysql',
				'--format', '{{.Names}}'
			]);

			if (stdout.includes('airo-app-mysql')) {
				console.log(chalk.green("✅ MySQL container is running"));
				return true;
			}

			console.log(
				chalk.yellow(
					"!  MySQL container not running. Start it with: docker compose up app-mysql -d",
				),
			);
			return false;
		} catch (error) {
			console.log(
				chalk.yellow(
					"!  MySQL container not running. Start it with: docker compose up app-mysql -d",
				),
			);
			return false;
		}
	}

	async checkSsoJwtBinary(): Promise<boolean> {
		try {
			const { execa } = await import("execa");
			await execa('ssojwt', ['--version']);
			return true;
		} catch (error) {
			return false;
		}
	}

	async getSsoJwtToken(): Promise<string | null> {
		try {
			const { execa } = await import("execa");
			const { stdout: token } = await execa('ssojwt');
			return token.trim();
		} catch (error) {
			console.log(chalk.red("❌ Failed to generate SSO JWT token"));
			return null;
		}
	}

	private async handleLegacySSO(): Promise<string | null> {
		// Legacy SSO JWT configuration
		const hasSsoJwtBinary = await this.checkSsoJwtBinary();

		if (hasSsoJwtBinary) {
			console.log(chalk.green("✅ SSO JWT binary found"));

			const { useSsoJwt } = await inquirer.prompt([
				{
					type: "confirm",
					name: "useSsoJwt",
					message: "Generate SSO JWT token for Getty Images?",
					default: true,
				},
			]);

			if (useSsoJwt) {
				console.log(chalk.blue("🔄 Generating SSO JWT token..."));
				const token = await this.getSsoJwtToken();
				if (token) {
					console.log(chalk.green("✅ SSO JWT token generated successfully"));
				}
				return token;
			}
		} else {
			console.log(chalk.yellow("!  SSO JWT binary not found"));
			console.log(
				chalk.blue(
					"📦 Install from: https://github.com/gdcorp-engineering/ssojwt",
				),
			);

			const { includeSsoJwt } = await inquirer.prompt([
				{
					type: "confirm",
					name: "includeSsoJwt",
					message: "Do you have an SSO JWT token to enter manually?",
					default: false,
				},
			]);

			if (includeSsoJwt) {
				const ssoAnswer = await inquirer.prompt([
					{
						type: "password",
						name: "ssoJwt",
						message: "SSO JWT Token:",
						validate: (input) =>
							input.length > 0 || "SSO JWT Token is required",
					},
				]);
				return ssoAnswer.ssoJwt;
			}
		}

		return null;
	}
}

