import config from "../lib/config";
import { App } from "aws-cdk-lib";
import {AiroBuilderStack} from "../lib/application-stack";
import { AiroBuilderHostedZoneStack } from "../lib/hostedzone-stack";
import { MySQLStack } from "../lib/mysql-stack";

// Main function to execute the CDK app
async function main() {
  const app: App = new App();

  // Define target deployment environment(s)
  const env = { account: config.account, region: config.region };

  // Create MySQL stack using existing VPC
  //new MySQLStack(app, 'MySQLStack', { env: env,});

  new AiroBuilderStack(app, 'AiroBuilderStack', { env: env });

  new AiroBuilderHostedZoneStack(app, 'AiroBuilderHostedZoneStack', { env: env });

  app.synth();
}

// Execute the main function
main().catch((error) => {
  console.error(error);
  process.exit(1);
});