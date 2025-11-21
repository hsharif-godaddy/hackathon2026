export interface CommerceOnboardingApplicationResponse {
  id?: string;
  individuals?: CommerceApplicant[];
  company?: CommerceCompany;
  store?: CommerceStore;
  channel?: CommerceChannel;
  metadata: CommerceMetadata;
  intent?: string;
  status: string;
  products: CommerceProduct[];
  commerceAccountFeatures?: string[];
  createdAt?: string;
  updatedAt?: string;
  submittedAt?: string;
}

export interface CommerceMetadata {
  boStatus?: string;
  context?: string;
  medium?: string;
  source?: string;
  referralUrlId?: string;
  riskDecision?: string;
  stepUpDetails?: string[];
  applicationLevel?: string;
  originalApplicationLevel?: string;
  businessId?: string;
  storeId?: string;
  channelId?: string;
  origin?: string;
  mode?: string;
}

export interface CommerceApplicant {
  id?: string;
  address?: CommerceAddress;
  communicationLanguage?: string;
  customerId?: string;
  // When includeIds is false (default for new apps), email is a string.
  // If includeIds is true (e.g. reverify), it is an object { id: string, emailAddress: string }
  email?: string | { id?: string; emailAddress?: string };
  dob?: string;
  phone?: CommercePhone;
  firstName?: string;
  lastName?: string;
  ip?: string;
  leadId?: string;
  decision?: string;
  stepUpDetails?: string;
  type?: string;
  inquiryId?: string;
  userId?: string;
  visitorId?: string;
  // Only present if includeIds is true
  governmentIdentification?: CommerceGovernmentIdentification;
  ownershipPercentage?: number;
  personaInquiryId?: string;
}

export interface CommerceCompany {
  id?: string;
  address?: CommerceAddress;
  category?: string;
  dba?: string;
  legalName?: string;
  mcc?: string;
  phone?: CommercePhone;
  website?: string;
  currency?: string;
  // Only present if includeIds is true
  governmentIdentification?: CommerceGovernmentIdentification;
  mccDetails?: {
    label: string;
    type: string;
  };
  gpv?: number;
  personaInquiryId?: string;
}

export interface CommerceStore {
  id?: string;
  name?: string;
  category?: string;
  website?: string;
  address?: CommerceAddress;
  ventureId?: string;
}

export interface CommerceChannel {
  id?: string;
  name?: string;
  type?: string;
  externalChannelId?: string;
  externalChannelType?: string;
}

export interface CommerceProduct {
  id?: string;
  name?: string;
  features: string[];
}

export interface CommerceAddress {
  id?: string;
  addressLine1?: string;
  addressLine2?: string;
  addressLine3?: string;
  adminArea1?: string; // City
  adminArea2?: string; // Territory/State
  adminArea3?: string;
  adminArea4?: string;
  postalCode?: string;
  countryCode?: string;
  addressDetails?: CommerceAddressDetails;
}

export interface CommerceAddressDetails {
  id?: string;
  streetNumber?: string;
  streetName?: string;
  streetType?: string;
  deliveryService?: string;
  buildingName?: string;
  subBuilding?: string;
  addressType?: string;
  geoCoordinates?: {
    longitude?: string;
    latitude?: string;
  };
}

export interface CommercePhone {
  id?: string;
  countryCode?: string;
  nationalNumber?: string;
  extensionNumber?: string;
}

export interface CommerceGovernmentIdentification {
  id?: string;
  type?: string;
  value?: string;
  sourceType?: string;
}

// Catalog Types

export interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor?: string;
  endCursor?: string;
}

export interface SimpleMoneyInput {
  currencyCode: string;
  value: number;
}

export interface SimpleMoney {
  currencyCode: string;
  value: number;
}

export interface PriceRange {
  min: number;
  max: number;
}

export interface CreateMediaObjectInput {
  label?: string;
  metafields?: CreateMetafieldInput[];
  name?: string;
  position?: number;
  type: 'PHOTO' | 'VIDEO' | 'IMAGE';
  url: string;
}

export interface UpdateMediaObjectInput {
  id: string;
  label?: string;
  metafields?: UpsertMetafieldInput[];
  name?: string;
  position?: number;
  type?: string;
  url?: string;
}

export interface CreateMetafieldInput {
  key: string;
  namespace: string;
  type: string;
  value: string;
}

export interface UpsertMetafieldInput {
  key: string;
  namespace: string;
  type: string;
  value: string;
}

export interface CreateReferenceInput {
  origin: string;
  value: string;
}

export interface CreateSKUPriceInput {
  compareAtValue?: SimpleMoneyInput;
  value: SimpleMoneyInput;
}

export interface CreateSKUInventoryInput {
  locationId: string;
  quantity: number;
}

export interface CreateSKUGroupSKUInput {
  backorderLimit?: number;
  code?: string;
  cost?: number; // deprecated
  description?: string;
  disableInventoryTracking?: boolean;
  disablePriceOverrides?: boolean;
  disableShipping?: boolean;
  eanCode?: string;
  gtinCode?: string;
  htmlDescription?: string;
  inventoryQuantities?: CreateSKUInventoryInput[];
  isbnCode?: string;
  label: string;
  mediaObjects?: CreateMediaObjectInput[];
  metafields?: CreateMetafieldInput[];
  name?: string;
  prices?: CreateSKUPriceInput[];
  references?: CreateReferenceInput[];
  shortLabel?: string;
  status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  unitCost?: SimpleMoneyInput;
  unitOfWeight?: 'KG' | 'GR' | 'LB' | 'OZ';
  upcCode?: string;
  weight?: number;
}

export interface CreateOptionInput {
  description?: string;
  label: string;
  metafields?: CreateMetafieldInput[];
  name?: string;
  position?: number;
  prices?: CreateOptionPriceInput[];
  type: string;
  validation?: CreateOptionValidationInput;
  values?: CreateOptionValueInput[];
}

export interface CreateOptionPriceInput {
  compareAtValue?: SimpleMoneyInput;
  value: SimpleMoneyInput;
}

export interface CreateOptionValidationInput {
  max?: number;
  min?: number;
}

export interface CreateOptionValueInput {
  label: string;
  metafields?: CreateMetafieldInput[];
  name?: string;
  position?: number;
  prices?: CreateOptionValuePriceInput[];
}

export interface CreateOptionValuePriceInput {
  compareAtValue?: SimpleMoneyInput;
  value: SimpleMoneyInput;
}

export interface CreateSKUGroupAttributeInput {
  description?: string;
  label: string;
  metafields?: CreateMetafieldInput[];
  name?: string;
  position?: number;
  values?: AssociateAttributeValueInput[];
}

export interface AssociateAttributeValueInput {
  label: string;
  name?: string;
  position?: number;
}

export interface SKUGroupChannelAddInput {
  channelId: string;
}

export interface MutationCreateSkuGroupInput {
  HTMLDescription?: string; // deprecated
  attributes?: CreateSKUGroupAttributeInput[];
  channels?: SKUGroupChannelAddInput[];
  description?: string;
  htmlDescription?: string;
  label: string;
  mediaObjects?: CreateMediaObjectInput[];
  metafields?: CreateMetafieldInput[];
  name?: string;
  options?: CreateOptionInput[];
  references?: CreateReferenceInput[];
  shortLabel?: string; // deprecated
  skus?: CreateSKUGroupSKUInput[];
  status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  type: string;
}

export interface MutationUpdateSkuGroupInput {
  description?: string;
  htmlDescription?: string;
  label?: string;
  metafields?: UpsertMetafieldInput[];
  name?: string;
  shortLabel?: string; // deprecated
  status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
}

// Response Types

export interface SKUPriceResponse {
  id: string;
  value: SimpleMoney;
  compareAtValue?: SimpleMoney;
}

export interface SKUResponse {
  id: string;
  label: string;
  name: string;
  code?: string;
  status: string;
  prices?: {
    edges: Array<{
      node: SKUPriceResponse;
    }>;
  };
}

export interface SKUGroupResponse {
  id: string;
  label: string;
  name: string;
  description?: string;
  htmlDescription?: string;
  status: string;
  type: string;
  priceRange?: PriceRange;
  compareAtPriceRange?: PriceRange;
  createdAt?: string;
  updatedAt?: string;
  skus?: {
    edges: Array<{
      node: SKUResponse;
    }>;
  };
}

export interface GetSkuGroupsResponse {
  skuGroups: {
    edges: Array<{
      node: SKUGroupResponse;
    }>;
    pageInfo: PageInfo;
    totalCount: number;
  };
}

export interface CreateSkuGroupResponse {
  createSkuGroup: SKUGroupResponse;
}

export interface UpdateSkuGroupResponse {
  updateSkuGroup: SKUGroupResponse;
}

export interface DeleteSkuGroupResponse {
  deleteSkuGroupById: {
    id: string;
  };
}
