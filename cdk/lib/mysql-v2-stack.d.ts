import { Construct } from 'constructs';
import * as rds from 'aws-cdk-lib/aws-rds';
import { GDStack, GDStackProps } from "@gd-safeguard/godaddy-constructs";
export declare class MySQLV2Stack extends GDStack {
    readonly clusters: rds.DatabaseCluster[];
    constructor(scope: Construct, id: string, props: GDStackProps);
}
