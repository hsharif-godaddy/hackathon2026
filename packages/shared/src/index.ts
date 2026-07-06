// Grants
export type { CreditGrant, GrantContextPayload } from './grants/index.js';
export { GrantType, GrantFinalState, LlmCallSource, GrantErrorCode } from './grants/index.js';
export { GrantManager, GrantUnusableReason } from './grants/index.js';

// Context Attachment
export type {
  ContextAttachmentMetadata,
  RenderStrategy,
  PersistenceStrategy,
  ContextAttachment,
  RenderedContext,
  ContextAttachmentRenderer,
  ContextAttachmentConfig,
} from './context-attachment/index.js';
export {
  createContextAttachment,
  isContextAttachment,
  isContextAttachmentArray,
  buildContextAttachments,
} from './context-attachment/index.js'
export type {
  BuildContextAttachmentsInput,
  BuildContextAttachmentsCustomContext,
  BuildContextAttachmentAsset,
  BuildContextAttachmentsBuildErrorContext,
} from './context-attachment/index.js'

// Chat / agents-app context
export type { AgentsAppContext, AgentsAppChatMessage } from './chat/index.js';
export { RESTORE, isRestoreMetadata } from './chat/index.js';
export type { RestoreActionMetadata } from './chat/index.js';

// Social
export { CONNECT_REQUEST_FROM_PUBLISH } from './social/index.js';
export type { ValidationDetails, PostImageData } from './social/index.js';

// AdSense
export type {
  AdSenseFieldName,
  AdSenseNormalizeResult,
  AdSenseParseResult,
  AdSensePublishManifest,
  AdSenseSettings,
  AdSenseSettingsInput,
  AdSenseSettingsWrite,
  AdSenseTextFileSettings,
  AdSenseValidationErrors,
} from './adsense/index.js';
export {
  ADSENSE_AUTHORING_CONFIG_PATH,
  ADSENSE_MANIFEST_FILENAME,
  ADSENSE_PUBLISHER_ID_PATTERN,
  ADSENSE_RUNTIME_MANIFEST_PATH,
  ADSENSE_TEXT_MAX_BYTES,
  buildCanonicalAdSenseScript,
  normalizeAdSenseSettingsInput,
  parseAdSensePublisherIdFromSnippet,
} from './adsense/index.js';

// Auth
export { SUPPORTED_AUTH_TYPES, isEmployeeAuthType } from './auth/index.js';
export type { SupportedAuthType, AuthType } from './auth/index.js';

// Domain (attach / site sync)
export { fqdnIsConnectedOrProvisioningOnSite, getConnectedOrProvisioningDomain } from './domain/index.js';
export type { SiteDomainForAttachCheck } from './domain/index.js';

// Site publish gating (shared by app UI and agents SEO audit)
export { hasBeenPublished, type PublishCheckableSite } from './site/index.js';

// Secrets composer save/cancel user-message tags (locale-stable detection)
export {
  buildSecretsComposerCancelUserMessage,
  buildSecretsComposerSuccessUserMessage,
  isSecretsComposerCancelUserContent,
  isSecretsComposerSuccessUserContent,
  parseSecretsComposerOutcomeKind,
  stripSecretsComposerOutcomeTag,
} from './secrets-composer-outcome/index.js';
export type { SecretsComposerOutcomeKind } from './secrets-composer-outcome/index.js';


// Media
export {
  AIRO_ASSET_UPLOADS_URL_PREFIX,
  getFilenameFromUploadUrl,
  isSafeUploadFilename,
  isSharedSlotReference,
  parseCollectionOccurrenceIndex,
} from './media/index.js';

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
} from './share-url/index.js';
export type { SharePayload } from './share-url/index.js';

// App Metadata
export type { AppMetadata, KnownAppMetadata } from './app-metadata/index.js';
export { mergeAppMetadata } from './app-metadata/index.js';

// Rebuild bring-over choice
export * from './rebuild/bring-over-choice.js';

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
} from './brand-data/index.js';

// Builder Layout (server-driven builder-layout descriptor + helpers)
export type {
  BuilderCanvasId,
  BuilderLayoutDescriptor,
  BuilderLayoutKind,
  BuilderPinnedSurface,
} from './builder-layout.js';
export {
  BUILDER_LAYOUT_VERSION,
  DEFAULT_BUILDER_LAYOUT,
  builderLayoutVariant,
  normalizeBuilderLayout,
} from './builder-layout.js';

// Design-kit layout translation (phase → descriptor; design-kit-specific)
export type { DesignKitBuildPhase } from './design-kit-layout.js';
export { DESIGN_KIT_BUILD_CANVAS_ID, designKitLayoutForPhase, isDesignKitBuildCanvas } from './design-kit-layout.js';
