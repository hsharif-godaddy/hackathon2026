import fs from "fs-extra";
import path from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import { GettyConfigSetup } from "./getty-config.js";

export interface ModelConfig {
	provider: "aws-bedrock" | "gocode";
	awsRegion?: string;
	awsAccessKeyId?: string;
	awsSecretAccessKey?: string;
	gocodeApiKey?: string;
	gocodeBaseUrl?: string;
}

export interface AuthConfig {
	useMockLogin: boolean;
	ssoLoginUrl?: string;
	ssoLogoutUrl?: string;
	authRealm?: string;
	authRisk?: string;
}

export interface AppEnvConfig {
	nodeEnv: string;
	databaseUrl: string;
	modelConfig: ModelConfig;
	authConfig: AuthConfig;
	port: number;
	httpsPort: number;
}

export interface AgentsEnvConfig {
	nodeEnv: string;
	appTemplateDir: string;
	showUsageCost: boolean;
	modelConfig: ModelConfig;
	mysqlRootHost: string;
	mysqlRootPort: number;
	mysqlRootUser: string;
	mysqlRootPass: string;
	ssoJwt?: string;
}

export class EnvGenerator {
	private projectRoot: string;
	private static readonly DEFAULT_DATABASE_URL =
		"mysql://airo:airopassword@localhost:3306/airo_app";

	constructor(projectRoot: string) {
		this.projectRoot = projectRoot;
	}

	async promptModelProvider(): Promise<ModelConfig> {
		console.log(chalk.cyan("\n🤖 AI Model Configuration"));

		const { provider } = await inquirer.prompt([
			{
				type: "list",
				name: "provider",
				message: "Which AI model provider would you like to use?",
				choices: [
					{ name: "AWS Bedrock (Claude models)", value: "aws-bedrock" },
					{ name: "GoCode (Custom endpoint)", value: "gocode" },
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

		const answers = await inquirer.prompt([
			{
				type: "input",
				name: "awsRegion",
				message: "AWS Region (e.g., us-east-1):",
				default: "us-east-1",
				validate: (input) => input.length > 0 || "AWS Region is required",
			},
			{
				type: "input",
				name: "awsAccessKeyId",
				message: "AWS Access Key ID:",
				validate: (input) =>
					input.length > 0 || "AWS Access Key ID is required",
			},
			{
				type: "password",
				name: "awsSecretAccessKey",
				message: "AWS Secret Access Key:",
				validate: (input) =>
					input.length > 0 || "AWS Secret Access Key is required",
			},
		]);

		return {
			provider: "aws-bedrock",
			...answers,
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

		const { authMethod } = await inquirer.prompt([
			{
				type: "list",
				name: "authMethod",
				message: "Which authentication method would you like to use?",
				choices: [
					{ name: "Mock Login (Development/Testing)", value: "mock" },
					{ name: "SSO Integration (Production)", value: "sso" },
				],
				default: "mock",
			},
		]);

		if (authMethod === "sso") {
			return await this.promptSSOConfig();
		} else {
			return {
				useMockLogin: true,
			};
		}
	}

	private async promptSSOConfig(): Promise<AuthConfig> {
		console.log(chalk.yellow("\n🔧 SSO Configuration"));

		const answers = await inquirer.prompt([
			{
				type: "input",
				name: "ssoLoginUrl",
				message: "SSO Login URL:",
				default: "https://sso.test-godaddy.com/login",
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
				name: "ssoLogoutUrl",
				message: "SSO Logout URL:",
				default: "https://sso.test-godaddy.com/logout",
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
			useMockLogin: false,
			...answers,
		};
	}

	generateAppEnvContent(config: AppEnvConfig): string {
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

# AI Model Configuration
`;

		if (config.modelConfig.provider === "aws-bedrock") {
			envContent += `# AWS Bedrock Configuration
AI_PROVIDER=aws-bedrock
AWS_REGION=${config.modelConfig.awsRegion}
AWS_ACCESS_KEY_ID=${config.modelConfig.awsAccessKeyId}
AWS_SECRET_ACCESS_KEY=${config.modelConfig.awsSecretAccessKey}
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
`;

		if (config.authConfig.useMockLogin) {
			envContent += `NEXT_PUBLIC_USE_MOCK_LOGIN=true
`;
		} else {
			envContent += `NEXT_PUBLIC_USE_MOCK_LOGIN=false
NEXT_PUBLIC_SSO_LOGIN_URL=${config.authConfig.ssoLoginUrl}
NEXT_PUBLIC_SSO_LOGOUT_URL=${config.authConfig.ssoLogoutUrl}

# Auth Configuration
NEXT_PUBLIC_AUTH_REALM=${config.authConfig.authRealm}
NEXT_PUBLIC_AUTH_RISK=${config.authConfig.authRisk}
`;
		}

		return envContent;
	}

	generateAgentsEnvContent(config: AgentsEnvConfig, gettyConfig?: string): string {
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
AWS_REGION=${config.modelConfig.awsRegion}
AWS_ACCESS_KEY_ID=${config.modelConfig.awsAccessKeyId}
AWS_SECRET_ACCESS_KEY=${config.modelConfig.awsSecretAccessKey}
`;
		} else {
			envContent += `# GoCode Configuration
OPENAI_API_KEY="${config.modelConfig.gocodeApiKey}"
OPENAI_BASE_URL="${config.modelConfig.gocodeBaseUrl}"
OPENAI_MODEL="claude-sonnet-4"
`;
		}

		envContent += `
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
# GETTY_API_URL=https://airobuilde-proxy-dev-private-ecs.airobuilde-dev-private.prod.onkatana.net/img/search
# GETTY_TOKEN=<your-token>
# IMAGE_SEARCH_DRIVER=getty
`;
		}

		return envContent;
	}

	async generateAppEnv(): Promise<void> {
		console.log(chalk.cyan("\n📝 Generating App Environment Configuration"));

		const modelConfig = await this.promptModelProvider();
		const authConfig = await this.promptAuthConfig();

		const config: AppEnvConfig = {
			nodeEnv: "development",
			databaseUrl: EnvGenerator.DEFAULT_DATABASE_URL,
			modelConfig,
			authConfig,
			port: 3000,
			httpsPort: 3443,
		};

		const envContent = this.generateAppEnvContent(config);
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

		// Show summary
		console.log(chalk.cyan("\n📋 Configuration Summary:"));
		console.log(`Database: MySQL (Docker container)`);
		console.log(`AI Provider: ${config.modelConfig.provider}`);
		console.log(
			`Authentication: ${config.authConfig.useMockLogin ? "Mock Login" : "SSO Integration"}`,
		);
		console.log(`App Port: ${config.port}`);
	}

	async generateAgentsEnv(): Promise<void> {
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
				configureGetty = "legacy-sso";
			}
		}

		if (configureGetty === "legacy-sso") {
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
					ssoJwt = await this.getSsoJwtToken();
					if (ssoJwt) {
						console.log(chalk.green("✅ SSO JWT token generated successfully"));
					}
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
					ssoJwt = ssoAnswer.ssoJwt;
				}
			}
		}

		const config: AgentsEnvConfig = {
			nodeEnv: "development",
			appTemplateDir: "app-templates/v8",
			showUsageCost: true,
			modelConfig,
			mysqlRootHost: mysqlConfig.mysqlRootHost,
			mysqlRootPort: parseInt(mysqlConfig.mysqlRootPort, 10),
			mysqlRootUser: mysqlConfig.mysqlRootUser,
			mysqlRootPass: mysqlConfig.mysqlRootPass,
			ssoJwt,
		};

		const envContent = this.generateAgentsEnvContent(config, gettyConfig);
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
			const { execSync } = await import("child_process");
			execSync(
				'docker ps --filter "name=airo-app-mysql" --format "{{.Names}}"',
				{
					encoding: "utf8",
					stdio: "pipe",
				},
			);
			console.log(chalk.green("✅ MySQL container is running"));
			return true;
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
			const { execSync } = await import("child_process");
			execSync("ssojwt --version", {
				encoding: "utf8",
				stdio: "pipe",
			});
			return true;
		} catch (error) {
			return false;
		}
	}

	async getSsoJwtToken(): Promise<string | null> {
		try {
			const { execSync } = await import("child_process");
			const token = execSync("ssojwt", {
				encoding: "utf8",
				stdio: "pipe",
			}).trim();
			return token;
		} catch (error) {
			console.log(chalk.red("❌ Failed to generate SSO JWT token"));
			return null;
		}
	}
}

