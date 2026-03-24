import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import { CertConfigSetup } from "./cert-config.js";
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
	knowbSsoJwt?: string;
}

export interface ImageSearchEnvConfig {
	awsProfile: string;
	awsRegion: string;
	port: number;
	logLevel: string;
	qdrantHost: string;
	qdrantPort: number;
	qdrantCollection: string;
	gettyAuthType: string;    // "sso-jwt" (direct) or "bearer" (via airo-proxy)
	gettyUpstream: string;
	gettyToken?: string;      // Bearer token for proxy auth (when gettyAuthType=bearer)
	gettyXAppKey?: string;    // x-app-key header value
	gettyCertPath?: string;   // Client cert path (when gettyAuthType=sso-jwt)
	gettyKeyPath?: string;    // Client key path (when gettyAuthType=sso-jwt)
	gettySsoHost?: string;    // SSO host for JWT token exchange
	gettyRateLimitRps: number;
	gettyConcurrency: number;
	anthropicApiUrl: string;
	anthropicApiKey?: string;
	haikuRateLimitRps: number;
	haikuConcurrency: number;
	openaiApiKey?: string;
	openaiBaseUrl?: string;
	s3Bucket: string;
	s3Region: string;
	s3Prefix: string;
	defaultMinCached: number;
	defaultMaxWaitSeconds: number;
	ssoHost: string;
	gettyConfigured: boolean;
	authType: string;
	jwksUrl: string;
}

export class EnvGenerator {
	private projectRoot: string;
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

	private async fetchGettyCerts(awsProfile: string): Promise<{ certPath: string; keyPath: string } | null> {
		const certSecretPath = "/Katana/Secrets/airobuilde/proxy/dev-private-ecs/GETTY_CERT";
		const keySecretPath = "/Katana/Secrets/airobuilde/proxy/dev-private-ecs/GETTY_KEY";
		const region = "us-west-2";

		try {
			const { execa } = await import("execa");

			console.log(chalk.blue("🔐 Fetching Getty client certificates from Secrets Manager..."));

			const certArgs = [
				"secretsmanager", "get-secret-value",
				"--secret-id", certSecretPath,
				"--region", region,
				"--query", "SecretString",
				"--output", "text",
				"--profile", awsProfile,
			];
			const keyArgs = [
				"secretsmanager", "get-secret-value",
				"--secret-id", keySecretPath,
				"--region", region,
				"--query", "SecretString",
				"--output", "text",
				"--profile", awsProfile,
			];

			const [certResult, keyResult] = await Promise.all([
				execa("aws", certArgs),
				execa("aws", keyArgs),
			]);

			const certContent = certResult.stdout.trim();
			const keyContent = keyResult.stdout.trim();

			if (!certContent || !keyContent || certContent === "null" || keyContent === "null") {
				throw new Error("Empty cert or key received from Secrets Manager");
			}

			// Write certs to image-search-service/certs/
			const certsDir = path.join(this.projectRoot, "image-search-service", "certs");
			await fs.ensureDir(certsDir);

			const certFilePath = path.join(certsDir, "client.crt");
			const keyFilePath = path.join(certsDir, "client.key");

			await fs.writeFile(certFilePath, certContent);
			await fs.writeFile(keyFilePath, keyContent, { mode: 0o600 });

			console.log(chalk.green("✅ Client certificates written to image-search-service/certs/"));

			return {
				certPath: "./certs/client.crt",
				keyPath: "./certs/client.key",
			};
		} catch (error: any) {
			console.log(chalk.red("❌ Failed to fetch Getty certificates:"));

			if (error.message?.includes("AccessDenied") || error.message?.includes("UnauthorizedOperation")) {
				console.log(chalk.yellow("   Check your AWS permissions for the proxy secrets"));
			} else if (error.message?.includes("ResourceNotFoundException")) {
				console.log(chalk.yellow(`   Secret not found. Check paths: ${certSecretPath}`));
			} else {
				console.log(chalk.gray(`   Error: ${error.message}`));
			}

			return null;
		}
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
		console.log(chalk.gray("Get your API key at: https://caas.open-webui.godaddy.com/workspace/apiKeys"));
		console.log(chalk.gray("Or navigate to: GoCaaS -> Workspace -> API Keys -> New API Key"));

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

		// Control plane via local-control-plane service
		envContent += `
# Control Plane (local-control-plane service)
MGMT_AIRO_BASE_URL=http://localhost:4100
`;

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
				appUrl: 'https://local.gasket.dev-godaddy.com:8443',
				ssoLoginUrl: 'https://sso.dev-godaddy.com/login',
				ssoLogoutUrl: 'https://sso.dev-godaddy.com/logout',
				loginRedirectUrl: 'https://local.gasket.dev-godaddy.com:8443/',
				awsRegion: config.awsRegion || 'us-west-2',
			},
			test: {
				appUrl: 'https://airo-builder.test-godaddy.com',
				ssoLoginUrl: 'https://sso.test-godaddy.com/login',
				ssoLogoutUrl: 'https://sso.test-godaddy.com/logout',
				loginRedirectUrl: 'https://airo-builder.test-godaddy.com:8443/',
				awsRegion: config.awsRegion || 'us-west-2',
			},
			prod: {
				appUrl: 'https://airo-builder.godaddy.com',
				ssoLoginUrl: 'https://sso.godaddy.com/login',
				ssoLogoutUrl: 'https://sso.godaddy.com/logout',
				loginRedirectUrl: 'https://airo-builder.godaddy.com:8443/',
				awsRegion: config.awsRegion || 'us-west-2',
			},
		};

		const envConfig = envConfigs[env];
		const envName = env.charAt(0).toUpperCase() + env.slice(1);

		let content = `# Airo Builder - ${envName} Environment Configuration
# Generated by setup utility
# This file is loaded when GASKET_ENV=local.${env}

# =============================================================================
# Authentication Architecture Overview
# =============================================================================
# This application uses TWO SEPARATE authentication layers:
#
# LEVEL 1: Customer/User Authentication (GoDaddy SSO)
#   - Variables: SSO_LOGIN_URL, SSO_LOGOUT_URL, LOGIN_REDIRECT_URL
#   - Purpose: Authenticate users logging into the Airo Builder application
#   - Sets: auth_idp cookie on builder domain (.dev-godaddy.com, etc.)
#
# LEVEL 2: Preview App & Agent Authentication (Site-Scoped JWT)
#   - Variables: NEXT_PUBLIC_APP_URL, JWT_PRIVATE_KEY, JWT_PUBLIC_KEY
#   - Purpose: Authenticate preview apps on different domains and agent API calls
#   - Uses: Builder issues site-scoped JWT tokens validated via JWKS endpoint
#
# For detailed documentation:
# - docs/preview-app-authentication.md
# - docs/ui-agents-authentication-architecture.md

# Application URL (Level 2 JWT Authentication)
# Used to construct JWKS endpoint URL for preview app JWT validation
# Preview apps fetch the builder's public keys from: {NEXT_PUBLIC_APP_URL}/.well-known/jwks.json
NEXT_PUBLIC_APP_URL=${envConfig.appUrl}

# SSO Configuration (Level 1 Customer Authentication)
SSO_LOGIN_URL=${envConfig.ssoLoginUrl}
SSO_LOGOUT_URL=${envConfig.ssoLogoutUrl}
LOGIN_REDIRECT_URL=${envConfig.loginRedirectUrl}

# AWS Configuration
AWS_REGION=${envConfig.awsRegion}
`;

		if (env === 'test' || env === 'prod') {
			const mgmtUrl = env === 'test' ? 'https://mgmt.nstk.net' : 'https://mgmt.woosaas.godaddy.com';
			content += `
# Management API Base URL (control plane)
MGMT_AIRO_BASE_URL=${mgmtUrl}
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

# MySQL configuration (used by agents for per-app databases)
MYSQL_ROOT_HOST=${config.mysqlRootHost}
MYSQL_ROOT_PORT=${config.mysqlRootPort}
MYSQL_ROOT_USER=${config.mysqlRootUser}
MYSQL_ROOT_PASS=${config.mysqlRootPass}
`;

		// KnowB Configuration
		if (config.knowbSsoJwt) {
			envContent += `
# KnowB Knowledge Base Configuration
# Used for RAG (Retrieval-Augmented Generation) searches
# CLI tool available: pnpm --filter @airo/agents tsx scripts/knowb-cli.ts
SSO_JWT=${config.knowbSsoJwt}
# GODADDY_API_BASE_URL=https://knowb.api.int.test-godaddy.com
`;
		} else {
			envContent += `
# KnowB Knowledge Base Configuration (Not configured - run setup again to configure)
# Used for RAG (Retrieval-Augmented Generation) searches
# CLI tool available: pnpm --filter @airo/agents tsx scripts/knowb-cli.ts
# SSO_JWT=<your-sso-jwt-token>
# GODADDY_API_BASE_URL=https://knowb.api.int.test-godaddy.com
`;
		}

		if (gettyConfig) {
			envContent += gettyConfig;
		} else if (config.ssoJwt) {
			envContent += `
# Required for Getty Images (Legacy SSO JWT)
# Note: If SSO_JWT is set above for KnowB, it will also be used for Getty
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

	async generateAppEnv(yesToAll: boolean = false, commerceResult: CommerceSetupResult | null = null): Promise<{ authType: "none" | "mock" | "jwt" }> {
		console.log(chalk.cyan("\n📝 Generating App Environment Configuration"));

		const authConfig = await this.promptAuthConfig(yesToAll);
		const awsProfile = await this.promptAppAwsProfile(yesToAll);

		const config: AppEnvConfig = {
			nodeEnv: "development",
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
			return { authType: config.authConfig.authType };
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

		return { authType: config.authConfig.authType };
	}

	/**
	 * Generate environment-specific configuration files for agents
	 * Creates .env.local.dev, .env.local.test, and .env.local.prod
	 */
	generateAgentsEnvLocalContent(env: 'dev' | 'test' | 'prod'): string {
		const envConfigs = {
			dev: {
				jwksUrl: 'https://local.gasket.dev-godaddy.com:8443/.well-known/jwks.json',
				ssoHost: 'sso.dev-godaddy.com',
			},
			test: {
				jwksUrl: 'https://airo-builder.test-godaddy.com/.well-known/jwks.json',
				ssoHost: 'sso.test-godaddy.com',
			},
			prod: {
				jwksUrl: 'https://airo-builder.godaddy.com/.well-known/jwks.json',
				ssoHost: 'sso.godaddy.com',
			},
		};

		const envConfig = envConfigs[env];
		const envName = env.charAt(0).toUpperCase() + env.slice(1);

		return `# Airo Builder - Agents ${envName} Environment Configuration
# Generated by setup utility
# This file is loaded when GASKET_ENV=local.${env}

# =============================================================================
# JWT Configuration (Level 2: UI-to-Agents Authentication)
# =============================================================================

# JWKS endpoint URL for fetching builder's public keys to validate JWT tokens
# MUST match the NEXT_PUBLIC_APP_URL from app/.env.local.${env}
JWKS_URL=${envConfig.jwksUrl}

# Site ID for JWT authorization (typically set by deployment system in production)
# SITE_ID=default-site

# =============================================================================
# SSO Configuration for Diagnostics Endpoint
# =============================================================================

# SSO host for JOMAX token validation (used by /diagnostics/memory endpoint)
SSO_HOST=${envConfig.ssoHost}
`;
	}

	async generateAgentsEnv(yesToAll: boolean = false, commerceResult: CommerceSetupResult | null = null, authType?: "none" | "mock" | "jwt"): Promise<void> {
		console.log(chalk.cyan("\n📝 Generating Agents Environment Configuration"));

		// If authType not provided (standalone mode), prompt for it
		let resolvedAuthType: "none" | "mock" | "jwt" = authType ?? "jwt";
		if (!authType) {
			if (yesToAll) {
				console.log(chalk.gray(`Automated mode: using JWT authentication (default)`));
			} else {
				console.log(chalk.cyan("\n🔐 Authentication Configuration"));
				console.log(chalk.gray("Choose the authentication type for the agents service:"));
				console.log(chalk.gray("Note: This should match the app authentication configuration.\n"));

				const response = await inquirer.prompt([
					{
						type: "list",
						name: "authType",
						message: "Which authentication type would you like to use?",
						choices: [
							{
								name: "JWT - Full authentication with app (Recommended for proper local testing)",
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
				resolvedAuthType = response.authType;
			}
		}

		const modelConfig = await this.promptModelProvider(yesToAll);

		console.log(chalk.cyan("\n🗄 MySQL Configuration (used by agents for per-app databases)"));

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

		// KnowB Configuration
		console.log(chalk.cyan("\n📚 KnowB Knowledge Base Configuration"));
		console.log(chalk.gray("KnowB enables RAG (Retrieval-Augmented Generation) for design style searches."));
		console.log(chalk.gray("Requires ssojwt binary: https://github.com/gdcorp-engineering/ssojwt"));
		console.log(chalk.gray("CLI tool available: pnpm --filter @airo/agents tsx scripts/knowb-cli.ts"));

		let knowbSsoJwt: string | undefined;

		const defaultConfigureKnowb = "skip";
		let configureKnowb = defaultConfigureKnowb;

		if (yesToAll) {
			console.log(chalk.gray("Automated mode: skipping KnowB configuration"));
		} else {
			const response = await inquirer.prompt([
				{
					type: "list",
					name: "configureKnowb",
					message: "How would you like to configure KnowB?",
					choices: [
						{ name: "Generate SSO JWT token (requires ssojwt binary)", value: "generate" },
						{ name: "Enter SSO JWT token manually", value: "manual" },
						{ name: "Skip KnowB configuration", value: "skip" }
					],
					default: defaultConfigureKnowb
				}
			]);
			configureKnowb = response.configureKnowb;
		}

		if (configureKnowb === "generate") {
			const hasSsoJwtBinary = await this.checkSsoJwtBinary();
			if (hasSsoJwtBinary) {
				console.log(chalk.blue("🔄 Generating SSO JWT token for KnowB (test environment)..."));
				const token = await this.getSsoJwtToken();
				if (token) {
					knowbSsoJwt = token;
					console.log(chalk.green("✅ SSO JWT token generated successfully"));
				} else {
					console.log(chalk.yellow("⚠️  Failed to generate token. You can configure KnowB later."));
				}
			} else {
				console.log(chalk.yellow("⚠️  ssojwt binary not found."));
				console.log(chalk.blue("📦 Install from: https://github.com/gdcorp-engineering/ssojwt"));
			}
		} else if (configureKnowb === "manual") {
			const { token } = await inquirer.prompt([
				{
					type: "password",
					name: "token",
					message: "Enter your SSO JWT token:",
					validate: (input) => input.length > 0 || "SSO JWT Token is required",
				},
			]);
			knowbSsoJwt = token;
			console.log(chalk.green("✅ SSO JWT token configured"));
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
			authType: resolvedAuthType, // Sync with app authentication type for proper local testing
			mysqlRootHost: mysqlConfig.mysqlRootHost,
			mysqlRootPort: parseInt(mysqlConfig.mysqlRootPort, 10),
			mysqlRootUser: mysqlConfig.mysqlRootUser,
			mysqlRootPass: mysqlConfig.mysqlRootPass,
			ssoJwt,
			knowbSsoJwt,
		};

		const envContent = this.generateAgentsEnvContent(config, gettyConfig, commerceAgentsConfig);
		const agentsEnvPath = path.join(this.projectRoot, "agents", ".env");

		const written = await this.writeEnvFileWithPrompt(agentsEnvPath, envContent, "Agents", yesToAll);
		if (!written) {
			return;
		}

		// Generate environment-specific configuration files for agents
		console.log(chalk.cyan("\nGenerating agents environment-specific configuration files..."));

		const environments: Array<'dev' | 'test' | 'prod'> = ['dev', 'test', 'prod'];
		const generatedFiles: string[] = [];

		for (const env of environments) {
			const envLocalContent = this.generateAgentsEnvLocalContent(env);
			const envLocalPath = path.join(this.projectRoot, "agents", `.env.local.${env}`);

			await fs.writeFile(envLocalPath, envLocalContent);
			generatedFiles.push(`.env.local.${env}`);
			console.log(chalk.green(`   Generated .env.local.${env}`));
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

		let knowbStatus = "Not configured";
		if (knowbSsoJwt) {
			knowbStatus = "SSO JWT configured";
		}
		console.log(`KnowB: ${knowbStatus}`);

		let gettyStatus = "Not configured";
		if (gettyConfig) {
			gettyStatus = "AWS Proxy configured";
		} else if (ssoJwt) {
			gettyStatus = "Legacy SSO JWT configured";
		}
		console.log(`Getty Images: ${gettyStatus}`);
		console.log(`Environment Files: ${generatedFiles.join(', ')}`);

		console.log(chalk.cyan("\n🚀 Environment Usage:"));
		console.log(`   ${chalk.blue('pnpm --filter @airo/agents run dev')}         → Uses .env.local.dev`);
		console.log(`   ${chalk.blue('pnpm --filter @airo/agents run local:test')}  → Uses .env.local.test`);
		console.log(`   ${chalk.blue('pnpm --filter @airo/agents run local:prod')}  → Uses .env.local.prod`);
	}

	generateImageSearchEnvContent(config: ImageSearchEnvConfig): string {
		let envContent = `# Image Search Service - Environment Configuration
# Generated by setup utility

# AWS Profile (use the SSO profile set up by ./setup.sh)
# Run: aws sso login --profile ${config.awsProfile}
AWS_PROFILE=${config.awsProfile}
AWS_REGION=${config.awsRegion}

# Service
PORT=${config.port}
LOG_LEVEL=${config.logLevel}

# Qdrant Vector Database
QDRANT_HOST=${config.qdrantHost}
QDRANT_PORT=${config.qdrantPort}
QDRANT_COLLECTION=${config.qdrantCollection}
QDRANT_API_KEY=

# Getty Images API
# AUTH_TYPE controls how the service authenticates to the Getty proxy:
#   "sso-jwt" (recommended) - Direct to GoDaddy Getty proxy using client TLS cert
#   "bearer" - Via airo-builder proxy using Bearer token
GETTY_AUTH_TYPE=${config.gettyAuthType}
GETTY_UPSTREAM=${config.gettyUpstream}
GETTY_X_APP_KEY=${config.gettyXAppKey || 'airo-app-builder'}
GETTY_RATE_LIMIT_RPS=${config.gettyRateLimitRps}
GETTY_CONCURRENCY=${config.gettyConcurrency}
${config.gettyAuthType === 'sso-jwt' ? `
# SSO JWT Auth (direct to GoDaddy Getty proxy)
# Client TLS cert/key for SSO token exchange
GETTY_CERT_PATH=${config.gettyCertPath || ''}
GETTY_KEY_PATH=${config.gettyKeyPath || ''}
GETTY_SSO_HOST=${config.gettySsoHost || 'sso.godaddy.com'}` : `
# Bearer Token Auth (via airo-builder proxy)
GETTY_TOKEN=${config.gettyToken || ''}`}

# Anthropic API (Haiku for image analysis) - via GoCode proxy
ANTHROPIC_API_URL=${config.anthropicApiUrl}
ANTHROPIC_API_KEY=${config.anthropicApiKey || ''}
HAIKU_RATE_LIMIT_RPS=${config.haikuRateLimitRps}
HAIKU_CONCURRENCY=${config.haikuConcurrency}

# OpenAI API (Embeddings) - via GoCode proxy
OPENAI_API_KEY=${config.openaiApiKey || ''}
OPENAI_BASE_URL=${config.openaiBaseUrl || ''}

# S3 Backup Storage (shared bucket for caching analyses across developers)
# This bucket is created by the CDK stack - see cdk/lib/image-search-stack.ts
S3_BUCKET=${config.s3Bucket}
S3_REGION=${config.s3Region}
S3_PREFIX=${config.s3Prefix}

# Response Behavior
DEFAULT_MIN_CACHED=${config.defaultMinCached}
DEFAULT_MAX_WAIT_SECONDS=${config.defaultMaxWaitSeconds}

# SSO (for auth)
SSO_HOST=${config.ssoHost}

# Authentication
# AUTH_TYPE: "jwt" for production (validates tokens), "none" for local dev (no auth)
AUTH_TYPE=${config.authType}
JWKS_URL=${config.jwksUrl}

# APM (optional)
ELASTIC_APM_SERVER_URL=
ELASTIC_APM_SERVICE_NAME=image-search-service
ELASTIC_APM_ENVIRONMENT=dev
`;

		return envContent;
	}

	async generateImageSearchEnv(yesToAll: boolean = false): Promise<void> {
		console.log(chalk.cyan("\n📝 Generating Image Search Service Environment Configuration"));

		// Check for existing AWS profile
		const currentProfile = await this.checkExistingAWSProfile();
		const defaultAwsProfile = currentProfile || "airobuild-dev-private-sso";

		let awsProfile = defaultAwsProfile;
		if (!yesToAll && currentProfile) {
			const { useExistingProfile } = await inquirer.prompt([
				{
					type: "confirm",
					name: "useExistingProfile",
					message: `Use existing AWS profile '${currentProfile}'?`,
					default: true,
				},
			]);

			if (!useExistingProfile) {
				const response = await inquirer.prompt([
					{
						type: "input",
						name: "awsProfile",
						message: "AWS Profile name:",
						default: defaultAwsProfile,
					},
				]);
				awsProfile = response.awsProfile;
			}
		} else if (yesToAll) {
			console.log(chalk.gray(`Automated mode: using AWS profile '${defaultAwsProfile}'`));
		}

		// API Keys configuration (via GoCode proxy)
		console.log(chalk.cyan("\n🔑 GoCode API Key Configuration"));
		console.log(chalk.gray("The image-search-service uses GoCode proxy for both Anthropic and OpenAI APIs."));
		console.log(chalk.gray("You can use the same GoCode API key for both."));
		console.log(chalk.gray("Get your API key at: https://caas.open-webui.godaddy.com/workspace/apiKeys"));
		console.log(chalk.gray("Or navigate to: GoCaaS -> Workspace -> API Keys -> New API Key"));

		const envGocodeKey = process.env.APPBUILDER_GOCODE_API_TOKEN;
		const envAnthropicKey = process.env.ANTHROPIC_API_KEY || envGocodeKey;
		const envOpenaiKey = process.env.OPENAI_API_KEY || envGocodeKey;

		let anthropicApiKey = envAnthropicKey || "";
		let openaiApiKey = envOpenaiKey || "";

		if (yesToAll) {
			if (!envGocodeKey && !envAnthropicKey) {
				const warningMsg = "GoCode API key not found in environment. Edit image-search-service/.env manually.";
				this.addWarning(warningMsg);
			} else {
				console.log(chalk.green("✅ Using GoCode API key from environment"));
				anthropicApiKey = envGocodeKey || envAnthropicKey || "";
				openaiApiKey = envGocodeKey || envOpenaiKey || "";
			}
		} else {
			if (envGocodeKey) {
				console.log(chalk.green("✅ Using APPBUILDER_GOCODE_API_TOKEN from environment"));
				anthropicApiKey = envGocodeKey;
				openaiApiKey = envGocodeKey;
			} else if (envAnthropicKey || envOpenaiKey) {
				console.log(chalk.green("✅ Using API keys from environment"));
			} else {
				console.log(chalk.gray("💡 Tip: Set APPBUILDER_GOCODE_API_TOKEN in your environment to use as default"));
			}

			const apiKeyAnswers = await inquirer.prompt([
				{
					type: "input",
					name: "gocodeApiKey",
					message: "GoCode API Key (used for both Anthropic and OpenAI via proxy):",
					default: envGocodeKey || envAnthropicKey || "",
				},
			]);

			anthropicApiKey = apiKeyAnswers.gocodeApiKey;
			openaiApiKey = apiKeyAnswers.gocodeApiKey;
		}

		// Getty configuration
		console.log(chalk.cyan("\n🖼️  Getty Images Configuration"));

		let gettyAuthType = "sso-jwt";
		let gettyToken = "";
		let gettyXAppKey = "airo-app-builder";
		let gettyUpstream = "https://getty-images-proxy.api.godaddy.com";
		let gettyCertPath = "";
		let gettyKeyPath = "";
		let gettySsoHost = "sso.godaddy.com";
		let gettyConfigured = false;

		const defaultGettyChoice = "sso-jwt";
		let configureGetty = defaultGettyChoice;

		if (yesToAll) {
			console.log(chalk.gray("Automated mode: attempting SSO JWT Getty configuration..."));
		} else {
			const response = await inquirer.prompt([
				{
					type: "list",
					name: "configureGetty",
					message: "How would you like to configure Getty Images?",
					choices: [
						{ name: "Direct SSO JWT auth to Getty proxy (recommended)", value: "sso-jwt" },
						{ name: "Bearer token via airo-builder proxy (legacy)", value: "bearer" },
						{ name: "Enter Getty configuration manually", value: "manual" },
						{ name: "Skip Getty configuration", value: "skip" }
					],
					default: defaultGettyChoice
				}
			]);
			configureGetty = response.configureGetty;
		}

		if (configureGetty === "sso-jwt" || (yesToAll && configureGetty === defaultGettyChoice)) {
			// SSO JWT: Fetch client cert/key from Secrets Manager
			console.log(chalk.gray("SSO JWT auth requires client TLS certificates from Secrets Manager."));

			const gettySetup = new GettyConfigSetup();
			let fetchedAwsProfile = await gettySetup.checkAWSCredentials();

			if (!fetchedAwsProfile) {
				fetchedAwsProfile = await gettySetup.setupAWSCredentials(yesToAll);
			}

			if (fetchedAwsProfile) {
				const certResult = await this.fetchGettyCerts(fetchedAwsProfile);
				if (certResult) {
					gettyCertPath = certResult.certPath;
					gettyKeyPath = certResult.keyPath;
					gettyConfigured = true;
					console.log(chalk.green("✅ Getty SSO JWT configured with client certificates"));
				} else {
					if (yesToAll) {
						this.addWarning('Getty cert/key fetch failed. Configure Getty later by running setup again.');
					} else {
						console.log(chalk.yellow("Failed to fetch Getty certificates. You can configure manually later."));
					}
				}
			} else {
				if (yesToAll) {
					this.addWarning('No AWS credentials for Getty cert fetch. Configure Getty later.');
				} else {
					console.log(chalk.yellow("No AWS credentials available for certificate fetch."));
				}
			}
		} else if (configureGetty === "bearer") {
			// Legacy Bearer token via airo-builder proxy
			gettyAuthType = "bearer";
			gettyUpstream = "https://airobuilde-proxy-dev-private-ecs.airobuilde-dev-private.prod.onkatana.net";

			const gettySetup = new GettyConfigSetup();
			const result = await gettySetup.setup(yesToAll);

			if (result.success && result.envConfig) {
				const lines = result.envConfig.split('\n');
				for (const line of lines) {
					if (line.startsWith('GETTY_API_URL=')) {
						gettyUpstream = line.replace('GETTY_API_URL=', '');
					} else if (line.startsWith('GETTY_TOKEN=')) {
						gettyToken = line.replace('GETTY_TOKEN=', '');
					}
				}
				gettyConfigured = true;
				console.log(chalk.green("✅ Getty Bearer token configured"));
			} else {
				if (yesToAll) {
					this.addWarning('Getty proxy configuration failed. Configure Getty later by running setup again.');
				} else {
					console.log(chalk.yellow("Getty proxy configuration failed."));
				}
			}
		} else if (configureGetty === "manual") {
			const authResponse = await inquirer.prompt([
				{
					type: "list",
					name: "authType",
					message: "Getty auth type:",
					choices: [
						{ name: "SSO JWT (direct to Getty proxy)", value: "sso-jwt" },
						{ name: "Bearer token (via airo-builder proxy)", value: "bearer" },
					],
					default: "sso-jwt"
				}
			]);
			gettyAuthType = authResponse.authType;

			if (gettyAuthType === "sso-jwt") {
				const response = await inquirer.prompt([
					{
						type: "input",
						name: "certPath",
						message: "Client certificate path:",
						default: "./certs/client.crt",
					},
					{
						type: "input",
						name: "keyPath",
						message: "Client key path:",
						default: "./certs/client.key",
					},
				]);
				gettyCertPath = response.certPath;
				gettyKeyPath = response.keyPath;
			} else {
				gettyUpstream = "https://airobuilde-proxy-dev-private-ecs.airobuilde-dev-private.prod.onkatana.net";
				const response = await inquirer.prompt([
					{
						type: "input",
						name: "gettyToken",
						message: "Getty Token (Bearer token for airo-builder proxy):",
					},
				]);
				gettyToken = response.gettyToken;
			}
			gettyConfigured = true;
		}

		// GoCode proxy URL for AI APIs
		const gocodeProxyUrl = "https://caas-gocode-prod.caas-prod.prod.onkatana.net";

		const config: ImageSearchEnvConfig = {
			awsProfile,
			awsRegion: "us-west-2",
			port: 8080,
			logLevel: "info",
			qdrantHost: "127.0.0.1",
			qdrantPort: 6334,
			qdrantCollection: "image_analyses",
			gettyAuthType,
			gettyUpstream,
			gettyToken,
			gettyXAppKey,
			gettyCertPath,
			gettyKeyPath,
			gettySsoHost,
			gettyRateLimitRps: 50,
			gettyConcurrency: 10,
			anthropicApiUrl: gocodeProxyUrl,
			anthropicApiKey,
			haikuRateLimitRps: 20,
			haikuConcurrency: 5,
			openaiApiKey,
			openaiBaseUrl: gocodeProxyUrl,
			s3Bucket: "airo-image-analyses-dev",
			s3Region: "us-west-2",
			s3Prefix: "analyses/v1",
			defaultMinCached: 5,
			defaultMaxWaitSeconds: 30,
			ssoHost: "sso.godaddy.com",
			gettyConfigured,
			authType: "none", // Local dev doesn't need auth
			jwksUrl: "https://airo-builder.test-godaddy.com/.well-known/jwks.json",
		};

		const envContent = this.generateImageSearchEnvContent(config);
		const imageSearchEnvPath = path.join(this.projectRoot, "image-search-service", ".env");

		await this.writeEnvFileWithPrompt(imageSearchEnvPath, envContent, "Image Search Service", yesToAll);

		console.log(chalk.cyan("\n📋 Configuration Summary:"));
		console.log(`AWS Profile: ${config.awsProfile}`);
		console.log(`AWS Region: ${config.awsRegion}`);
		console.log(`S3 Bucket: ${config.s3Bucket}`);
		console.log(`Qdrant: ${config.qdrantHost}:${config.qdrantPort}`);
		console.log(`Anthropic API Key: ${config.anthropicApiKey ? "configured" : "not configured"}`);
		console.log(`OpenAI API Key: ${config.openaiApiKey ? "configured" : "not configured"}`);
		if (config.gettyConfigured) {
			if (config.gettyAuthType === "sso-jwt") {
				console.log(`Getty Images: SSO JWT (direct to Getty proxy)`);
				console.log(`Getty Cert: ${config.gettyCertPath || "not configured"}`);
				console.log(`Getty Key: ${config.gettyKeyPath || "not configured"}`);
			} else {
				console.log(`Getty Images: Bearer token (via airo-builder proxy)`);
				console.log(`Getty Token: ${config.gettyToken ? "configured" : "not configured"}`);
			}
			console.log(`Getty X-App-Key: ${config.gettyXAppKey}`);
		} else {
			console.log(`Getty Images: not configured`);
		}

		console.log(chalk.cyan("\n🚀 Next Steps:"));
		console.log(`   1. ${chalk.blue('aws sso login --profile ' + config.awsProfile)}`);
		console.log(`   2. ${chalk.blue('cd image-search-service && docker compose up -d')}  # Start Qdrant`);
		console.log(`   3. ${chalk.blue('cd image-search-service && make run')}  # Start the service`);
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
			const { stdout: token } = await execa('ssojwt', ['-e', 'test']);
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
				console.log(chalk.blue("🔄 Generating SSO JWT token (test environment)..."));
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

