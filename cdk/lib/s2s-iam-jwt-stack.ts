import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { GDStack, GDStackProps } from "@gd-safeguard/godaddy-constructs";

import config from "./config";

export class S2sIamJwtStack extends GDStack {
  constructor(scope: Construct, id: string, props: GDStackProps) {
    super(scope, id, props);

    const s2sIamJwtRole = new iam.Role(this, 'S2sIamJwtRole', {
      roleName: `${config.envName}-s2s-iam-jwt-access`,
      description: 'Generic S2S IAM JWT role for Airo Builder backend services',
      assumedBy: new iam.CompositePrincipal(
        ...config.s2sIamJwtAssumeRoleArns.map(arn => new iam.ArnPrincipal(arn)),
        new iam.ArnPrincipal(`arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:role/GD-AWS-USA-GD-AiroBuilde-Ops`)
      ),
      inlinePolicies: {
        iamJwtAccess: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                "execute-api:Invoke"
              ],
              resources: config.awsIamJwtAccount.map(account =>
                `arn:aws:execute-api:*:${account}:*`
              )
            })
          ]
        })
      },
    });

    new cdk.CfnOutput(this, 'S2sIamJwtRoleArn', {
      value: s2sIamJwtRole.roleArn,
      description: 'ARN of the generic S2S IAM JWT role',
      exportName: `${config.envName}-s2s-iam-jwt-role-arn`
    });
  }
}
