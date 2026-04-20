// Default lookback window for care conversations. Care support agents expect
// to see anything from the last month by default; tighten via the UI if you
// need a smaller window. Shared so the client and proxy stay in sync.
export const DEFAULT_CARE_LOOKBACK_MINUTES = 60 * 24 * 30;

// Upper bound we're willing to forward to the upstream Care service. The regex
// alone (\d{1,7}) tops out at ~19 years which is absurd; cap at 90 days so a
// compromised caller can't force huge range scans upstream.
export const MAX_CARE_LOOKBACK_MINUTES = 60 * 24 * 90;

export interface CareConversationLeg {
    ucid: string;
    contactId: string;
    initialContactId?: string;
    state?: string;
    agentId?: string;
    agentDisplayName?: string;
    agentType?: string;
    permission?: string;
    channel?: string;
    supportLevel?: string;
    platform?: string;
    conversationStartTimestamp?: string;
    conversationEndTimestamp?: string;
    durationSeconds?: string | number;
    summary?: string;
    deviceInfo?: string;
    location?: string;
    app?: string;
    market?: string;
    customerDisplayName?: string;
    brandCustomerId?: string;
    customerId?: string;
    visitId?: string;
    visitorId?: string;
    disconnectReason?: string;
    endDescription?: string;
}

export interface CareConversationInfo {
    ucid: string;
    initialContactId?: string;
    id?: string;
    customerDisplayName?: string;
    brandCustomerId?: string;
    customerId?: string;
    visitId?: string;
    visitorId?: string;
    createdAt?: string;
    updatedAt?: string;
    platform?: string;
    channel?: string;
    market?: string;
    customerJoinedTimestamp?: string;
    location?: string;
    app?: string;
    summary?: string;
    conversationEndTimestamp?: string;
    durationSeconds?: number;
    deviceInfo?: string;
    contactCenterId?: string;
    contactCenterInstanceId?: string;
    connectInstanceAlias?: string;
    customerAuthenticated?: boolean;
    brandId?: string;
    plId?: string;
    conversations?: CareConversationLeg[];
}

export interface CareConversationItem {
    conversationInfo: CareConversationInfo;
}

export interface CareConversationsResponse {
    status: string;
    message: string;
    data: CareConversationItem[];
    hasMore?: boolean;
}

export interface CareTranscriptAttachment {
    attachmentName?: string;
    attachmentUrl?: string;
}

export interface CareTranscriptMessage {
    messageId: string;
    participantId?: string;
    participantName?: string;
    participantRole?: string;
    content?: string;
    contentType?: string;
    source?: string;
    absoluteTime?: string;
    attachments?: CareTranscriptAttachment[];
}

export interface CareTranscriptData {
    id?: string;
    ucid?: string;
    contactId?: string;
    lastEvaluatedKey?: string | null;
    transcripts?: CareTranscriptMessage[];
}

export interface CareTranscriptResponse {
    status: string;
    message: string;
    data: CareTranscriptData;
}
