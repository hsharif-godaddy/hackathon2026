/**
 * GraphQL type definitions
 */

/**
 * Project group enum from GraphQL schema
 */
export enum ProjectGroup {
    AAP = 'aap',
    AiGeneratedMedia = 'aigeneratedmedia',
    Domain = 'domain',
    GdConversations = 'gdconversations',
    GdPayments = 'gdpayments',
    LtoDomain = 'ltodomain',
    OlStore = 'olstore',
    Productivity = 'productivity',
    QSC = 'qsc',
    Shield = 'shield',
    SSLCert = 'sslcert',
    SSLManage = 'sslmanage',
    VNext = 'vnext',
    WooSaaS = 'woosaas',
    WordPress = 'wordpress',
    WST7 = 'wst7',
}

/**
 * Project status enum from GraphQL schema
 */
export enum ProjectStatus {
    Active = 'ACTIVE',
    Cancelled = 'CANCELLED',
    Free = 'FREE',
    Freemium = 'FREEMIUM',
    Inactive = 'INACTIVE',
    PendCancel = 'PENDCANCEL',
    PendingCancel = 'PENDING_CANCEL',
    PendingProvisioning = 'PENDING_PROVISIONING',
    PendReg = 'PENDREG',
    Suspended = 'SUSPENDED',
    Trial = 'TRIAL',
}
