interface Config {
    account: string;
    region: string;
    envName: string;
    v2CellAccount: string;
    databases: string[];
    vpnIps: any;
    backupRetentionDays: number;
    serverlessV2MinCapacity: number;
    serverlessV2MaxCapacity: number;
    mysqlReadersCount: number;
    bedrockAssumeRoleArns: string[];
    gocodeAssumeRoleArns: string[];
    awsIamJwtAccount: string;
}
declare let config: Config;
export default config;
