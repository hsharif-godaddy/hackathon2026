/**
 * MCP elicitation types for browser-side clients.
 *
 * This models the client-visible pieces of the MCP draft elicitation flow plus
 * the in-band continuation shape used by AAB MCP transports: a tool can return
 * an input_required result, the client collects answers, then the same tool call
 * is retried with inputResponses and any echoed requestState.
 */

/** Elicitation mode. An absent mode is treated as form for compatibility. */
export type ElicitationMode = 'form' | 'url';

export interface ElicitationSchemaOption {
  const: string;
  title?: string;
}

interface ElicitationSchemaBase {
  title?: string;
  description?: string;
}

export interface ElicitationStringSchema extends ElicitationSchemaBase {
  type: 'string';
  minLength?: number;
  maxLength?: number;
  format?: 'email' | 'uri' | 'date' | 'date-time';
  default?: string;
}

export interface ElicitationNumberSchema extends ElicitationSchemaBase {
  type: 'number' | 'integer';
  minimum?: number;
  maximum?: number;
  default?: number;
}

export interface ElicitationBooleanSchema extends ElicitationSchemaBase {
  type: 'boolean';
  default?: boolean;
}

export interface ElicitationUntitledSingleSelectEnumSchema extends ElicitationSchemaBase {
  type: 'string';
  enum: string[];
  /** Stable MCP enum labels. Draft titled enums use oneOf[{ const, title }]. */
  enumNames?: string[];
  default?: string;
}

export interface ElicitationTitledSingleSelectEnumSchema extends ElicitationSchemaBase {
  type: 'string';
  oneOf: ElicitationSchemaOption[];
  default?: string;
}

export type ElicitationSingleSelectEnumSchema =
  | ElicitationUntitledSingleSelectEnumSchema
  | ElicitationTitledSingleSelectEnumSchema;

export interface ElicitationUntitledMultiSelectEnumSchema extends ElicitationSchemaBase {
  type: 'array';
  minItems?: number;
  maxItems?: number;
  items: {
    type: 'string';
    enum: string[];
    /** Stable MCP enum labels for multi-select item values. */
    enumNames?: string[];
  };
  default?: string[];
}

export interface ElicitationTitledMultiSelectEnumSchema extends ElicitationSchemaBase {
  type: 'array';
  minItems?: number;
  maxItems?: number;
  items: {
    anyOf: ElicitationSchemaOption[];
  };
  default?: string[];
}

/**
 * JSON-Schema subset used for form-mode requestedSchema properties.
 * The schema is flat: object properties describe primitive fields, enum/oneOf
 * single-select fields, or array fields with enum/anyOf items.
 */
export type ElicitationSchemaProperty =
  | ElicitationStringSchema
  | ElicitationNumberSchema
  | ElicitationBooleanSchema
  | ElicitationSingleSelectEnumSchema
  | ElicitationUntitledMultiSelectEnumSchema
  | ElicitationTitledMultiSelectEnumSchema;

/** Flat object schema for form-mode elicitation. */
export interface ElicitationRequestedSchema {
  $schema?: string;
  type: 'object';
  properties: Record<string, ElicitationSchemaProperty>;
  required?: string[];
}

/** Params for a form-mode elicitation/create request. */
export interface ElicitationFormParams {
  mode?: 'form';
  message: string;
  requestedSchema: ElicitationRequestedSchema;
}

/** Params for a url-mode elicitation/create request. */
export interface ElicitationUrlParams {
  mode: 'url';
  message: string;
  /**
   * Draft URL-mode elicitation shape. The SDK v1 stable line also models an
   * elicitationId; AAB's in-band continuation keys URL state by inputRequests id.
   */
  url: string;
}

export type ElicitationParams = ElicitationFormParams | ElicitationUrlParams;

/** A single server-to-client elicitation request, keyed by id in inputRequests. */
export interface ElicitInputRequest {
  method: 'elicitation/create';
  params: ElicitationParams;
}

/**
 * Tool result signalling that the server needs user input before it can
 * complete. The client renders each inputRequests entry, then retries the
 * original tools/call with matching inputResponses and the echoed requestState.
 */
export interface InputRequiredResult {
  resultType: 'input_required';
  inputRequests?: Record<string, ElicitInputRequest>;
  requestState?: string;
  _meta?: Record<string, unknown>;
}

/** The MCP elicitation response action model. */
export type ElicitAction = 'accept' | 'decline' | 'cancel';

export type ElicitContentValue = string | number | boolean | string[];

/**
 * Client answer to one elicitation request.
 * Form accepts include content values. Url accepts omit content because the
 * sensitive interaction stays out of band.
 */
export interface ElicitResult {
  action: ElicitAction;
  content?: Record<string, ElicitContentValue>;
}

/** Map of inputRequests id to the client's ElicitResult. */
export type ElicitResponses = Record<string, ElicitResult>;

export interface ElicitationClientCapabilities {
  elicitation: {
    /** Present when the client can handle form-mode elicitation requests. */
    form?: {
      /** Whether the client applies schema defaults before returning content. */
      applyDefaults?: boolean;
    };
    /** Present when the client can handle URL-mode elicitation requests. */
    url?: Record<string, never>;
  };
}

/** Initialize capability payload for AAB's platform MCP elicitation support. */
export const MCP_ELICITATION_CLIENT_CAPABILITIES = {
  elicitation: {
    form: {},
    url: {},
  },
} as const satisfies ElicitationClientCapabilities;
