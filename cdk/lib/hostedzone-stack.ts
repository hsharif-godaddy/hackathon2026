import * as route53 from 'aws-cdk-lib/aws-route53';
import * as gdcdk from '@gd-safeguard/godaddy-constructs';
import { Construct } from 'constructs';
import config from "./config";

export class AiroBuilderHostedZoneStack extends gdcdk.GDStack {
    prefix: string = `${config.envName}-airo-builder`;
    public readonly hostingZone: route53.IHostedZone;

    constructor(scope: Construct, id: string, props: gdcdk.GDStackProps) {
        super(scope, id, props);

            this.hostingZone = new route53.PublicHostedZone(this, `${this.prefix}-hosted-zone`, {
                zoneName: config.route53BaseDomain,
                comment: 'GD Cloud hosted zone for Airo Builder',
                addTrailingDot: false
            });
    }
}
