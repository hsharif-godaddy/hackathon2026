declare module '@social/social-flows' {
  import type { FunctionComponent } from 'react'

  export type onCompletePayload = {
    status: string
    payload?: object
  }

  export type onConnectionPayload = {
    status: string
    payload?: object
  }

  interface FBConnectFlowProps {
    market: string
    rootDomain: string
    sourceApp: string
    businessName: string
    onComplete: (arg: onCompletePayload | undefined) => void
    onConnection?: (arg: onConnectionPayload | undefined) => void
    modal?: boolean | null
    SignInInfoComponent?: object
    SuccessInfoComponent?: object
    createFlowProps?: object
    vnextProps?: object
    signInRedirectOpts?: object
    userTokenId?: string
  }

  export const FBConnectFlow: FunctionComponent<FBConnectFlowProps>
}
