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
	authConfig: AuthConfig;
	awsProfile?: string;
	awsRegion?: string;
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
	private warnings: string[] = [];

	constructor(projectRoot: string, warnings?: string[]) {
		this.projectRoot = projectRoot;
		this.awsSSO = new AWSSSoSetup();
		this.warnings = warnings || [];
	}

	private addWarning(message: string): void {
		this.warnings.push(message);
	}

	private async writeEnvFileWithPrompt(
		filePath: string,
		content: string,
		displayName: string,
		yesToAll: boolean = false
	): Promise<boolean> {
		if (await fs.pathExists(filePath)) {
			if (yesToAll) {
				console.log(chalk.gray(`Automated mode: overwriting existing ${displayName} .env file`));
				await fs.writeFile(filePath, content);
				console.log(chalk.green(`✅ Generated ${displayName} .env file: ${filePath}`));
				return true;
			}

			const defaultOverwrite = false;
			const { overwrite } = await inquirer.prompt([
				{
					type: "confirm",
					name: "overwrite",
					message: `${displayName} .env file already exists. Overwrite it?`,
					default: defaultOverwrite,
				},
			]);

			if (!overwrite) {
				console.log(chalk.yellow(`⏭  Skipping ${displayName} .env generation`));
				return false;
			}
		}

		await fs.writeFile(filePath, content);
		console.log(chalk.green(`✅ Generated ${displayName} .env file: ${filePath}`));
		return true;
	}

	private async promptCommerceConfig(
		promptForCommerce: boolean,
		commerceResult: CommerceSetupResult | null,
		configType: 'appEnvConfig' | 'agentsEnvConfig'
	): Promise<string | undefined> {
		if (commerceResult && commerceResult[configType]) {
			return commerceResult[configType];
		}

		if (!promptForCommerce) {
			return undefined;
		}

		console.log(chalk.cyan("\n🛒 GoDaddy Commerce Configuration"));

		const { configureCommerce } = await inquirer.prompt([
			{
				type: "confirm",
				name: "configureCommerce",
				message: "Would you like to enable and configure GoDaddy Commerce?",
				default: true
			}
		]);

		if (!configureCommerce) {
			return undefined;
		}

		const commerceSetup = new CommerceConfigSetup();
		const localCommerceResult = await commerceSetup.setup();

		if (localCommerceResult.success && localCommerceResult[configType]) {
			return localCommerceResult[configType];
		}

		console.log(chalk.yellow("Commerce configuration failed, skipping..."));
		return undefined;
	}

	private async checkExistingAWSProfile(): Promise<string | null> {
		try {
			const { execa } = await import("execa");

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
			}

			try {
				await execa('aws', [
					'sts', 'get-caller-identity',
					'--query', 'Arn',
					'--output', 'text'
				]);
				return process.env.AWS_PROFILE || 'default';
			} catch {
			}

			return null;
		} catch {
			return null;
		}
	}

	async promptModelProvider(yesToAll: boolean = false): Promise<ModelConfig> {
		console.log(chalk.cyan("\n🤖 AI Model Configuration"));

		const defaultProvider = "gocode";
		let provider = defaultProvider;

		if (yesToAll) {
			console.log(chalk.gray(`Automated mode: using ${defaultProvider.toUpperCase()} (recommended default)`));
		} else {
			const response = await inquirer.prompt([
				{
					type: "list",
					name: "provider",
					message: "Which AI model provider would you like to use?",
					choices: [
						{ name: "GoCode (Recommended)", value: "gocode" },
						{ name: "AWS Bedrock (Legacy)", value: "aws-bedrock" },
					],
					default: defaultProvider
				},
			]);
			provider = response.provider;
		}

		if (provider === "aws-bedrock") {
			return await this.promptAWSBedrockConfig(yesToAll);
		} else {
			return await this.promptGoCodeConfig(yesToAll);
		}
	}

	private async promptAWSBedrockConfig(yesToAll: boolean = false): Promise<ModelConfig> {
		console.log(chalk.yellow("\n🔧 AWS Bedrock Configuration"));
		console.log("You'll need AWS credentials with Bedrock access.");
		console.log("");

		const defaultAwsRegion = "us-west-2";
		const currentProfile = await this.checkExistingAWSProfile();

		if (currentProfile) {
			if (yesToAll) {
				console.log(chalk.gray(`Automated mode: using existing AWS profile '${currentProfile}' with region ${defaultAwsRegion}`));
				return {
					provider: "aws-bedrock",
					awsRegion: defaultAwsRegion,
					awsProfile: currentProfile,
				};
			}

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
						default: defaultAwsRegion,
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

		if (yesToAll) {
			const warningMsg = "AWS Bedrock selected but no AWS profile found. Configure AWS credentials manually in agents/.env if you want to use AWS Bedrock";
			this.addWarning(warningMsg);
			return {
				provider: "aws-bedrock",
				awsRegion: defaultAwsRegion,
				awsProfile: undefined
			};
		}

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

	private async promptGoCodeConfig(yesToAll: boolean = false): Promise<ModelConfig> {
		console.log(chalk.yellow("\n🔧 GoCode Configuration"));

		const defaultBaseUrl = "https://caas-gocode-prod.caas-prod.prod.onkatana.net";
		const envApiKey = process.env.APPBUILDER_GOCODE_API_TOKEN;

		if (envApiKey) {
			console.log(chalk.green("✅ Using APPBUILDER_GOCODE_API_TOKEN from environment"));
		} else {
			if (process.platform === "win32") {
				console.log(chalk.gray("💡 Tip: Set APPBUILDER_GOCODE_API_TOKEN in System Environment Variables or PowerShell profile to use as default"));
			} else {
				console.log(chalk.gray("💡 Tip: Set APPBUILDER_GOCODE_API_TOKEN in your shell profile (~/.zshrc, ~/.bashrc, or ~/.profile) to use as default"));
			}
		}

		let answers;

		if (yesToAll) {
			console.log(chalk.gray(`Automated mode: using default GoCode base URL`));
			if (!envApiKey) {
				const warningMsg = "GoCode API key not found in environment. Edit agents/.env and replace 'REPLACE_WITH_YOUR_API_KEY' with your actual API key. (Tip: Set APPBUILDER_GOCODE_API_TOKEN environment variable before running setup to avoid this)";
				this.addWarning(warningMsg);
			}
			answers = {
				gocodeBaseUrl: defaultBaseUrl,
				gocodeApiKey: envApiKey || "REPLACE_WITH_YOUR_API_KEY"
			};
		} else {
			answers = await inquirer.prompt([
				{
					type: "input",
					name: "gocodeBaseUrl",
					message: "GoCode Base URL:",
					default: defaultBaseUrl,
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
					type: "input",
					name: "gocodeApiKey",
					message: "GoCode API Key:",
					default: envApiKey,
					validate: (input) => input.length > 0 || "GoCode API Key is required",
				},
			]);
		}

		return {
			provider: "gocode",
			...answers,
		};
	}

	async promptAuthConfig(yesToAll: boolean = false): Promise<AuthConfig> {
		console.log(chalk.cyan("\n🔐 Authentication Configuration"));

		const defaultAuthType = "jwt";
		let authType = defaultAuthType;

		if (yesToAll) {
			console.log(chalk.gray(`Automated mode: using ${defaultAuthType.toUpperCase()} authentication (default)`));
		} else {
			console.log(chalk.gray("Choose the authentication type for your development environment:"));

			const response = await inquirer.prompt([
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
					default: defaultAuthType,
				},
			]);
			authType = response.authType;
		}

		if (authType === "jwt") {
			return await this.promptSSOConfig(yesToAll);
		} else {
			return {
				authType: authType as "none" | "jwt",
				useMockLogin: false
			};
		}
	}

	async promptAppAwsProfile(yesToAll: boolean = false): Promise<string | undefined> {
		console.log(chalk.cyan("\n☁️  AWS Profile Configuration"));
		console.log(chalk.gray("The app requires an AWS profile for various AWS service integrations."));

		const currentProfile = await this.checkExistingAWSProfile();

		if (currentProfile) {
			const defaultUseExisting = true;

			if (yesToAll) {
				console.log(chalk.gray(`Automated mode: using existing AWS profile '${currentProfile}' (default)`));
				return currentProfile;
			}

			const { useExistingProfile } = await inquirer.prompt([
				{
					type: "confirm",
					name: "useExistingProfile",
					message: `Use existing AWS profile '${currentProfile}' for the app?`,
					default: defaultUseExisting,
				},
			]);

			if (useExistingProfile) {
				return currentProfile;
			}
		}

		if (yesToAll) {
			console.log(chalk.gray("Automated mode: skipping AWS profile configuration"));
			return undefined;
		}

		const defaultSetupChoice = "sso";

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
				default: defaultSetupChoice,
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

	private async promptSSOConfig(yesToAll: boolean = false): Promise<AuthConfig> {
		console.log(chalk.yellow("\n🔧 SSO Configuration"));
		console.log(chalk.gray("SSO URLs are configured per environment in .env.local.{dev|test|prod} files"));
		console.log(chalk.gray("These base settings apply when no environment-specific config is loaded\n"));

		const defaultAuthRealm = "idp";
		const defaultAuthRisk = "low";

		let answers;

		if (yesToAll) {
			console.log(chalk.gray(`Automated mode: using default SSO configuration (authRealm: ${defaultAuthRealm}, authRisk: ${defaultAuthRisk})`));
			answers = {
				authRealm: defaultAuthRealm,
				authRisk: defaultAuthRisk
			};
		} else {
			answers = await inquirer.prompt([
				{
					type: "input",
					name: "authRealm",
					message: "Auth Realm:",
					default: defaultAuthRealm,
					validate: (input) => input.length > 0 || "Auth Realm is required",
				},
				{
					type: "list",
					name: "authRisk",
					message: "Auth Risk Level:",
					choices: ["low", "medium", "high"],
					default: defaultAuthRisk,
				},
			]);
		}

		return {
			authType: "jwt",
			useMockLogin: false,
			...answers,
		};
	}

	generateAppEnvContent(config: AppEnvConfig, certSetup?: string, commerceConfig?: string): string {
		let envContent = `# Airo Builder - App Environment Configuration
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
				awsRegion: config.awsRegion || 'us-west-2',
			},
			test: {
				ssoLoginUrl: 'https://sso.test-godaddy.com/login',
				ssoLogoutUrl: 'https://sso.test-godaddy.com/logout',
				loginRedirectUrl: 'https://airo-builder.test-godaddy.com:8443/',
				agentsServiceUrl: 'http://localhost:4000',
				awsRegion: config.awsRegion || 'us-west-2',
			},
			prod: {
				ssoLoginUrl: 'https://sso.godaddy.com/login',
				ssoLogoutUrl: 'https://sso.godaddy.com/logout',
				loginRedirectUrl: 'https://airo-builder.godaddy.com:8443/',
				agentsServiceUrl: 'http://localhost:4000',
				awsRegion: config.awsRegion || 'us-west-2',
			},
		};

		const envConfig = envConfigs[env];
		const envName = env.charAt(0).toUpperCase() + env.slice(1);

		let content = `# Airo Builder - ${envName} Environment Configuration
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
		let envContent = `# Airo Builder - Agents Environment Configuration
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

# Social Feature Enablement
ENABLE_SOCIAL=false
`;
		}

		return envContent;
	}

	async generateAppEnv(yesToAll: boolean = false, commerceResult: CommerceSetupResult | null = null): Promise<void> {
		console.log(chalk.cyan("\n📝 Generating App Environment Configuration"));

		const authConfig = await this.promptAuthConfig(yesToAll);
		const awsProfile = await this.promptAppAwsProfile(yesToAll);

		const config: AppEnvConfig = {
			nodeEnv: "development",
			databaseUrl: EnvGenerator.DEFAULT_DATABASE_URL,
			authConfig,
			awsProfile,
			awsRegion: 'us-west-2',
			port: 3000,
			httpsPort: 8443,
		};

    let certSetupResult: { success: boolean; envConfig?: string } = { success: false };
    const certSetup = new CertConfigSetup();
    certSetupResult = await certSetup.setup(yesToAll);

    if (!certSetupResult.success && yesToAll) {
      const warningMsg = 'Client certificate configuration failed. You can configure certificates later by running setup again.';
      this.addWarning(warningMsg);
    }

		const commerceAppConfig = await this.promptCommerceConfig(
			!yesToAll,
			commerceResult,
			'appEnvConfig'
		);

		const envContent = this.generateAppEnvContent(
			config,
			certSetupResult.success ? certSetupResult.envConfig : undefined,
			commerceAppConfig
		);
		const appEnvPath = path.join(this.projectRoot, "app", ".env");

		const written = await this.writeEnvFileWithPrompt(appEnvPath, envContent, "App", yesToAll);
		if (!written) {
			return;
		}

		console.log(chalk.cyan("\nGenerating environment-specific configuration files..."));

		const environments: Array<'dev' | 'test' | 'prod'> = ['dev', 'test', 'prod'];
		const generatedFiles: string[] = [];

		for (const env of environments) {
			const envLocalContent = this.generateEnvLocalContent(env, config);
			const envLocalPath = path.join(this.projectRoot, "app", `.env.local.${env}`);

			await fs.writeFile(envLocalPath, envLocalContent);
			generatedFiles.push(`.env.local.${env}`);
			console.log(chalk.green(`   Generated .env.local.${env}`));
		}

		console.log(chalk.cyan("\n📋 Configuration Summary:"));
		console.log(`Database: MySQL (Docker container)`);
		console.log(`AWS Region: ${config.awsRegion || 'us-west-2'}`);
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

	async generateAgentsEnv(yesToAll: boolean = false, commerceResult: CommerceSetupResult | null = null): Promise<void> {
		console.log(chalk.cyan("\n📝 Generating Agents Environment Configuration"));

		const modelConfig = await this.promptModelProvider(yesToAll);

		console.log(chalk.cyan("\n🗄 MySQL Configuration (for app databases)"));

		const defaultMysqlConfig = {
			mysqlRootHost: "localhost",
			mysqlRootPort: "3306",
			mysqlRootUser: "root",
			mysqlRootPass: ""
		};

		let mysqlConfig;

		if (yesToAll) {
			console.log(chalk.gray(`Automated mode: using default MySQL configuration (${defaultMysqlConfig.mysqlRootUser}@${defaultMysqlConfig.mysqlRootHost}:${defaultMysqlConfig.mysqlRootPort})`));
			mysqlConfig = defaultMysqlConfig;
		} else {
			mysqlConfig = await inquirer.prompt([
				{
					type: "input",
					name: "mysqlRootHost",
					message: "MySQL Root Host:",
					default: defaultMysqlConfig.mysqlRootHost,
					validate: (input) => input.length > 0 || "MySQL Root Host is required",
				},
				{
					type: "input",
					name: "mysqlRootPort",
					message: "MySQL Root Port:",
					default: defaultMysqlConfig.mysqlRootPort,
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
					default: defaultMysqlConfig.mysqlRootUser,
					validate: (input) => input.length > 0 || "MySQL Root User is required",
				},
				{
					type: "password",
					name: "mysqlRootPass",
					message: "MySQL Root Password (leave empty for no password):",
					default: defaultMysqlConfig.mysqlRootPass,
				},
			]);
		}

		console.log(chalk.cyan("\n🖼️  Getty Images Configuration"));

		const defaultGettyChoice = "aws-proxy";
		let configureGetty = defaultGettyChoice;

		if (yesToAll) {
			console.log(chalk.gray("Automated mode: attempting Getty Images configuration..."));
		} else {
			const response = await inquirer.prompt([
				{
					type: "list",
					name: "configureGetty",
					message: "How would you like to configure Getty Images?",
					choices: [
						{ name: "Use AWS proxy with token from Secrets Manager (recommended)", value: "aws-proxy" },
						{ name: "Use legacy SSO JWT token", value: "legacy-sso" },
						{ name: "Skip Getty configuration", value: "skip" }
					],
					default: defaultGettyChoice
				}
			]);
			configureGetty = response.configureGetty;
		}

		let gettyConfig: string | undefined;
		let ssoJwt: string | undefined;

		if (configureGetty === "aws-proxy") {
			const gettySetup = new GettyConfigSetup();
			const result = await gettySetup.setup(yesToAll);

			if (result.success && result.envConfig) {
				gettyConfig = result.envConfig;
			} else {
				if (yesToAll) {
					const warningMsg = 'Getty Images configuration failed. You can configure Getty later by running setup again.';
					this.addWarning(warningMsg);
				} else {
					console.log(chalk.yellow("Getty AWS proxy configuration failed, falling back to legacy SSO method..."));
					const legacySsoResult = await this.handleLegacySSO();
					ssoJwt = legacySsoResult || undefined;
				}
			}
		}

		if (configureGetty === "legacy-sso") {
			ssoJwt = (await this.handleLegacySSO()) || undefined;
		}

		const commerceAgentsConfig = await this.promptCommerceConfig(
			!yesToAll,
			commerceResult,
			'agentsEnvConfig'
		);

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

		const written = await this.writeEnvFileWithPrompt(agentsEnvPath, envContent, "Agents", yesToAll);
		if (!written) {
			return;
		}

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

