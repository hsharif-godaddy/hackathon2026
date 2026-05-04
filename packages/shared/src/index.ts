// Grants
export type { CreditGrant, GrantContextPayload } from './grants/index.js'
export { GrantType, GrantFinalState, LlmCallSource, GrantErrorCode } from './grants/index.js'
export { GrantManager, GrantUnusableReason } from './grants/index.js'

// Context Attachment
export type {
  ContextAttachmentMetadata,
  RenderStrategy,
  PersistenceStrategy,
  ContextAttachment,
  RenderedContext,
  ContextAttachmentRenderer,
  ContextAttachmentConfig,
} from './context-attachment/index.js'
export { createContextAttachment, isContextAttachment, isContextAttachmentArray } from './context-attachment/index.js'

// WebSocket Context
export type { AgentsAppContext, AgentsAppChatMessage } from './websocket/index.js'

// Social
export { CONNECT_REQUEST_FROM_PUBLISH } from './social/index.js'
export type { ValidationDetails, PostImageData } from './social/index.js'

// Auth
export { SUPPORTED_AUTH_TYPES, isEmployeeAuthType } from './auth/index.js'
export type { SupportedAuthType, AuthType } from './auth/index.js'

// Domain (attach / site sync)
export { fqdnIsConnectedOrProvisioningOnSite } from './domain/index.js'
export type { SiteDomainForAttachCheck } from './domain/index.js'

// JSON
export { safeStringify } from './json/index.js'

// Share URL (base64url codec for /share/{encoded} BFF redirect)
export {
  CELL_PREFIX_REGEX,
  SITE_ID_REGEX,
  TOKEN_REGEX,
  decodeSharePayload,
  encodeSharePayload,
  isEncodableCellPrefix,
  isEncodableSiteId,
  isEncodableToken,
  tokenSuffix,
} from './share-url/index.js'
export type { SharePayload } from './share-url/index.js'

// Brand Data
export type {
  BrandData,
  BrandDataAudience,
  BrandDataColors,
  BrandDataIconography,
  BrandDataLayout,
  BrandDataMission,
  BrandDataPalette,
  BrandDataPersonality,
  BrandDataPhotography,
  BrandDataToneMatrix,
  BrandDataTypography,
  BrandDataVoice,
} from './brand-data/index.js'
