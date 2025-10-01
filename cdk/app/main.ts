import config from "../lib/config";
import { App } from "aws-cdk-lib";
import {AiroBuilderStack} from "../lib/application-stack";
import { MySQLV2Stack } from "../lib/mysql-v2-stack";

// Main function to execute the CDK app
async function main() {
  const app: App = new App();

  // Define target deployment environment(s)
  const env = { account: config.account, region: config.region };

  // Create MySQL V2 stack using existing VPC, for env based databases
  new MySQLV2Stack(app, 'MySQLV2Stack', { env: env });

  new AiroBuilderStack(app, 'AiroBuilderStack', { env: env });

  app.synth();
}

// Execute the main function
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
