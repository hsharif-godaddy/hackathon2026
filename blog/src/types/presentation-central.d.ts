declare module '@ux/presentation-central' {
  interface PresentationCentralParams {
    app: string;
    market: string;
    theme: string;
    manifest: string;
    [key: string]: string;
  }

  interface PresentationCentralOptions {
    version: string;
    env: string;
    params: PresentationCentralParams;
  }

  interface PresentationCentralClient {
    request: () => Promise<unknown>;
  }

  export default function presentationCentral(
    options: PresentationCentralOptions,
  ): PresentationCentralClient;
}
