import { execa } from "execa";
import chalk from "chalk";
import inquirer from "inquirer";
import { AWSSSoSetup } from "./aws-sso.js";

interface CommerceConfig {
  clientId: string; // Not a secret, hardcoded
  secretPaths: {
    clientSecret: string;
    encryptionKey: string;
  };
  apiBaseUrl: string;
  region: string;
}

interface CommerceCredentials {
  clientSecret: string;
  encryptionKey: string;
}

export class CommerceConfigSetup {
  private config: CommerceConfig = {
    clientId: "c16c68eb-0c20-437c-90bd-1c78911b3d48", // Public client ID
    secretPaths: {
      clientSecret:
        "/Katana/Secrets/airobuilde/app/dev-private-ecs/GODADDY_OAUTH_CLIENT_SECRET",
      encryptionKey:
        "/Katana/Secrets/airobuilde/app/dev-private-ecs/GODADDY_OAUTH_ENCRYPTION_KEY",
    },
    apiBaseUrl: "https://api.dev-godaddy.com",
    region: "us-west-2",
  };

  private ssoSetup = new AWSSSoSetup();

  async checkAWSCredentials(): Promise<string | null> {
    console.log(chalk.blue("🔍 Checking AWS credentials..."));

    // First, try the profile that our setup tool would create
    const setupToolProfile = await this.ssoSetup.getProfile();

    try {
      // Try the setup tool profile first
      const { stdout: identity } = await execa("aws", [
        "sts",
        "get-caller-identity",
        "--profile",
        setupToolProfile,
        "--query",
        "Arn",
        "--output",
        "text",
      ]);

      console.log(
        chalk.green(
          `✅ AWS credentials found using profile: ${setupToolProfile}`,
        ),
      );
      console.log(chalk.gray(`   Identity: ${identity.trim()}`));
      return setupToolProfile;
    } catch (setupProfileError) {
      console.log(
        chalk.yellow(
          `⚠️  Setup tool profile (${setupToolProfile}) credentials not available or expired`,
        ),
      );

      // Fall back to checking current/default credentials
      try {
        const { stdout: identity } = await execa("aws", [
          "sts",
          "get-caller-identity",
          "--query",
          "Arn",
          "--output",
          "text",
        ]);

        console.log(
          chalk.green("✅ AWS credentials found using current/default profile"),
        );
        console.log(chalk.gray(`   Identity: ${identity.trim()}`));

        // Get the current profile being used
        const profile = process.env.AWS_PROFILE || "default";
        return profile;
      } catch (defaultError) {
        console.log(chalk.yellow("⚠️  No valid AWS credentials found"));
        return null;
      }
    }
  }

  async setupAWSCredentials(): Promise<string | null> {
    console.log(
      chalk.blue(
        "🔧 Setting up AWS credentials for Commerce credentials access...",
      ),
    );
    console.log("");
    console.log(
      "To access Commerce credentials from AWS Secrets Manager, you need:",
    );
    console.log("• AWS SSO access to account 694282668781");
    console.log("• PowerUser role permissions");
    console.log("• Access to us-west-2 region");
    console.log("");

    const { setupSSO } = await inquirer.prompt([
      {
        type: "confirm",
        name: "setupSSO",
        message: "Set up AWS SSO credentials now?",
        default: true,
      },
    ]);

    if (!setupSSO) {
      console.log(
        chalk.yellow(
          "Skipping AWS SSO setup. You can set up credentials manually later.",
        ),
      );
      return null;
    }

    const success = await this.ssoSetup.setup();
    if (success) {
      return await this.ssoSetup.getProfile();
    }

    return null;
  }

  async fetchSecret(
    secretPath: string,
    awsProfile?: string,
  ): Promise<string | null> {
    try {
      const args = [
        "secretsmanager",
        "get-secret-value",
        "--secret-id",
        secretPath,
        "--region",
        this.config.region,
        "--query",
        "SecretString",
        "--output",
        "text",
      ];

      if (awsProfile) {
        args.push("--profile", awsProfile);
      }

      const { stdout: secret } = await execa("aws", args);

      if (
        secret &&
        secret.trim() !== "null" &&
        !secret.startsWith("An error occurred")
      ) {
        return secret.trim();
      } else {
        throw new Error("Invalid secret received from Secrets Manager");
      }
    } catch (error: any) {
      if (
        error.message?.includes("UnauthorizedOperation") ||
        error.message?.includes("AccessDenied")
      ) {
        console.log(chalk.yellow("   • Check your AWS permissions"));
        console.log(
          chalk.yellow("   • Ensure you have access to the secrets manager"),
        );
        console.log(
          chalk.yellow("   • Verify the AWS profile has PowerUser role"),
        );
      } else if (error.message?.includes("ResourceNotFoundException")) {
        console.log(
          chalk.yellow(`   • Secret not found at path: ${secretPath}`),
        );
        console.log(chalk.yellow("   • Check the secret path is correct"));
      } else if (
        error.message?.includes("ExpiredToken") ||
        error.message?.includes("InvalidUserID.NotFound")
      ) {
        console.log(chalk.yellow("   • AWS credentials expired or invalid"));
        console.log(
          chalk.yellow(
            "   • Try running: aws sso login --profile your-profile",
          ),
        );
      } else {
        console.log(chalk.gray(`   Error: ${error.message}`));
      }

      return null;
    }
  }

  async fetchCommerceCredentials(
    awsProfile?: string,
  ): Promise<CommerceCredentials | null> {
    console.log(
      chalk.blue(
        "🔐 Fetching Commerce credentials from AWS Secrets Manager...",
      ),
    );

    const clientSecret = await this.fetchSecret(
      this.config.secretPaths.clientSecret,
      awsProfile,
    );
    if (!clientSecret) {
      console.log(chalk.red("❌ Failed to fetch GODADDY_OAUTH_CLIENT_SECRET"));
      return null;
    }
    console.log(chalk.green("✅ Client Secret retrieved successfully"));
    console.log(chalk.gray(`   Secret: ${clientSecret.substring(0, 8)}...`));

    const encryptionKey = await this.fetchSecret(
      this.config.secretPaths.encryptionKey,
      awsProfile,
    );
    if (!encryptionKey) {
      console.log(chalk.red("❌ Failed to fetch GODADDY_OAUTH_ENCRYPTION_KEY"));
      return null;
    }
    console.log(chalk.green("✅ Encryption Key retrieved successfully"));
    console.log(chalk.gray(`   Key: ${encryptionKey.substring(0, 8)}...`));

    return { clientSecret, encryptionKey };
  }

  async generateCommerceEnvConfig(
    credentials: CommerceCredentials,
  ): Promise<string> {
    const envConfig = `

# GoDaddy Commerce OAuth Configuration
GODADDY_OAUTH_CLIENT_ID=${this.config.clientId}
GODADDY_OAUTH_CLIENT_SECRET=${credentials.clientSecret}
GODADDY_OAUTH_ENCRYPTION_KEY=${credentials.encryptionKey}
GODADDY_API_BASE_URL=${this.config.apiBaseUrl}
AGENT_URL=http://localhost:4000

# Commerce Agent Enablement
ENABLE_COMMERCE_AGENT=true`;

    return envConfig;
  }

  async generateCommerceAppEnvConfig(
    credentials: CommerceCredentials,
  ): Promise<string> {
    const appEnvConfig = `

# GoDaddy Commerce OAuth Configuration (for sandbox containers)
GODADDY_OAUTH_CLIENT_ID=${this.config.clientId}
GODADDY_OAUTH_CLIENT_SECRET=${credentials.clientSecret}
GODADDY_API_BASE_URL=${this.config.apiBaseUrl}`;

    return appEnvConfig;
  }

  async setup(): Promise<{
    success: boolean;
    agentsEnvConfig?: string;
    appEnvConfig?: string;
  }> {
    console.log(chalk.cyan.bold("🛒 GoDaddy Commerce Configuration"));
    console.log(chalk.gray("============================"));
    console.log("");

    console.log(
      "Configuring GoDaddy Commerce OAuth credentials for local development.",
    );
    console.log(`API Base URL: ${this.config.apiBaseUrl}`);
    console.log(`Client ID: ${this.config.clientId} (public)`);
    console.log(
      "Credentials source: AWS Secrets Manager (client secret & encryption key)",
    );
    console.log("");

    // Step 1: Check AWS credentials
    let awsProfile = await this.checkAWSCredentials();

    // Step 2: Set up AWS credentials if needed
    if (!awsProfile) {
      awsProfile = await this.setupAWSCredentials();

      if (!awsProfile) {
        console.log(chalk.red("❌ Cannot proceed without AWS credentials"));
        console.log("");
        console.log(chalk.yellow("Manual setup instructions:"));
        console.log(
          "1. Set up AWS credentials with access to account 694282668781",
        );
        console.log("2. Ensure you have PowerUser role permissions");
        console.log("3. Fetch the Commerce credentials manually:");
        console.log(
          chalk.gray(
            `   aws secretsmanager get-secret-value --secret-id "${this.config.secretPaths.clientSecret}" --region ${this.config.region} --query "SecretString" --output text`,
          ),
        );
        console.log(
          chalk.gray(
            `   aws secretsmanager get-secret-value --secret-id "${this.config.secretPaths.encryptionKey}" --region ${this.config.region} --query "SecretString" --output text`,
          ),
        );
        console.log("4. Add to your agents/.env:");
        console.log(
          chalk.gray(`   GODADDY_OAUTH_CLIENT_ID=${this.config.clientId}`),
        );
        console.log(
          chalk.gray(`   GODADDY_OAUTH_CLIENT_SECRET=<client-secret>`),
        );
        console.log(
          chalk.gray(`   GODADDY_OAUTH_ENCRYPTION_KEY=<encryption-key>`),
        );
        console.log(
          chalk.gray(`   GODADDY_API_BASE_URL=${this.config.apiBaseUrl}`),
        );
        console.log(chalk.gray(`   ENABLE_COMMERCE_AGENT=true`));
        console.log("5. Add to your app/.env:");
        console.log(
          chalk.gray(`   GODADDY_OAUTH_CLIENT_ID=${this.config.clientId}`),
        );
        console.log(
          chalk.gray(`   GODADDY_OAUTH_CLIENT_SECRET=<client-secret>`),
        );
        console.log(
          chalk.gray(`   GODADDY_API_BASE_URL=${this.config.apiBaseUrl}`),
        );
        return { success: false };
      }
    }

    // Step 3: Fetch Commerce credentials
    const credentials = await this.fetchCommerceCredentials(awsProfile);

    if (!credentials) {
      console.log(chalk.red("❌ Could not retrieve Commerce credentials"));
      console.log("");
      console.log(chalk.yellow("You can try manual setup:"));
      console.log("1. Ensure your AWS credentials are valid");
      console.log("2. Try refreshing SSO login:");
      console.log(chalk.gray(`   aws sso login --profile ${awsProfile}`));
      console.log("3. Then fetch the credentials manually (see above)");
      return { success: false };
    }

    // Step 4: Generate environment configurations
    const agentsEnvConfig = await this.generateCommerceEnvConfig(credentials);
    const appEnvConfig = await this.generateCommerceAppEnvConfig(credentials);

    console.log("");
    console.log(chalk.green.bold("🎉 Commerce configuration complete!"));
    console.log("");
    console.log("Configuration to add to agents/.env:");
    console.log(chalk.gray(agentsEnvConfig.trim()));
    console.log("");
    console.log("Configuration to add to app/.env:");
    console.log(chalk.gray(appEnvConfig.trim()));
    console.log("");

    return { success: true, agentsEnvConfig, appEnvConfig };
  }

  async quickCheck(): Promise<boolean> {
    console.log(chalk.blue("🔍 Quick Commerce configuration check..."));

    const awsProfile = await this.checkAWSCredentials();
    if (!awsProfile) {
      console.log(
        chalk.yellow(
          "⚠️  No AWS credentials found for Commerce credentials access",
        ),
      );
      return false;
    }

    const credentials = await this.fetchCommerceCredentials(awsProfile);
    if (!credentials) {
      console.log(chalk.yellow("⚠️  Could not access Commerce credentials"));
      return false;
    }

    console.log(chalk.green("✅ Commerce configuration is accessible"));
    return true;
  }
}
