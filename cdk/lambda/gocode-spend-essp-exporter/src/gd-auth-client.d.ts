declare module 'gd-auth-client' {
  interface IamTokenClientOptions {
    primaryRegion?: string;
    secondaryRegion?: string;
    credentialProviderChain?: () => Promise<{
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken?: string;
    }>;
  }

  export class IamTokenClient {
    constructor(ssoHost: string, options?: IamTokenClientOptions);
    getToken(): Promise<string>;
  }
}

