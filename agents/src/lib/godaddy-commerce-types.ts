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
  /**
   * Integer value in minor currency units (e.g. 550 for $5.50 USD).
   * GraphQL types this as Float to support values > 32-bit Int,
   * but only accepts integer values — decimals are rejected.
   */
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

export interface MutationUpdateSkuInput {
  backorderLimit?: number;
  code?: string;
  description?: string;
  disableInventoryTracking?: boolean;
  disablePriceOverrides?: boolean;
  disableShipping?: boolean;
  eanCode?: string;
  gtinCode?: string;
  htmlDescription?: string;
  isbnCode?: string;
  label?: string;
  metafields?: UpsertMetafieldInput[];
  name?: string;
  shortLabel?: string;
  status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  unitCost?: SimpleMoneyInput;
  unitOfWeight?: 'KG' | 'GR' | 'LB' | 'OZ';
  upcCode?: string;
  weight?: number;
}

export interface MutationUpdateSkuPriceInput {
  compareAtValue?: SimpleMoneyInput;
  value?: SimpleMoneyInput;
}

// Response Types

export interface SKUPriceResponse {
  id: string;
  value: SimpleMoney;
  compareAtValue?: SimpleMoney;
}

export interface SKUResponse {
  id: string;
  label: string | null;
  name: string;
  code?: string;
  status: string;
  prices?: {
    edges: Array<{
      node: SKUPriceResponse;
    }>;
  };
}

export interface AttributeValueResponse {
  id: string;
  label: string | null;
  name: string;
}

export interface AttributeResponse {
  id: string;
  label: string | null;
  name: string;
  values?: {
    edges: Array<{
      node: AttributeValueResponse;
    }>;
  };
}

export interface SKUGroupResponse {
  id: string;
  label: string | null;
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
  attributes?: {
    edges: Array<{
      node: AttributeResponse;
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

export interface CreateSkuPriceResponse {
  createSkuPrice: SKUPriceResponse;
}

export interface UpdateSkuGroupResponse {
  updateSkuGroup: SKUGroupResponse;
}

export interface UpdateSkuResponse {
  updateSku: SKUResponse;
}

export interface UpdateSkuPriceResponse {
  updateSkuPrice: SKUPriceResponse;
}

export interface AddAttributeValuesToSkuResponse {
  addAttributeValuesToSku: SKUResponse;
}

export interface DeleteSkuGroupResponse {
  deleteSkuGroupById: {
    id: string;
  };
}

// Media Types

export interface MediaObjectResponse {
  id: string;
  label: string | null;
  name: string | null;
  position: number | null;
  type: string;
  url: string;
}

export interface AddMediaObjectsToSkuGroupResponse {
  addMediaObjectsToSkuGroup: SKUGroupResponse;
}

export interface RemoveMediaObjectsFromSkuGroupResponse {
  removeMediaObjectsFromSkuGroup: SKUGroupResponse;
}

// Inventory Types

export interface InventoryCountResponse {
  id: string;
  quantity: number;
  type: 'AVAILABLE' | 'COMMITTED' | 'BACKORDERED';
  onHand?: number;
  createdAt: string;
  updatedAt: string;
  sku?: {
    id: string;
    label: string | null;
    name: string;
  };
  location?: {
    id: string;
    label: string | null;
    name: string;
  };
}

export interface InventoryAdjustmentResponse {
  id: string;
  delta: number;
  type: 'AVAILABLE' | 'COMMITTED' | 'BACKORDERED';
  createdAt: string;
  occurredAt?: string;
  sku?: {
    id: string;
    label: string | null;
    name: string;
  };
  location?: {
    id: string;
    label: string | null;
    name: string;
  };
}

export interface GetInventoryCountsResponse {
  inventoryCounts: {
    edges: Array<{
      node: InventoryCountResponse;
    }>;
    pageInfo: PageInfo;
    totalCount: number;
  };
}

export interface AdjustInventoryResponse {
  adjustInventory: InventoryAdjustmentResponse[];
}

export interface StockInventoryResponse {
  stockInventory: InventoryAdjustmentResponse[];
}

export interface MutationAdjustInventoryInput {
  skuId: string;
  locationId: string;
  delta: number;
  references?: CreateReferenceInput[];
}

export interface MutationStockInventoryInput {
  skuId: string;
  locationId: string;
  quantity: number;
  references?: CreateReferenceInput[];
}

// Location Types

export interface LocationAddressResponse {
  addressLine1: string;
  addressLine2?: string;
  addressLine3?: string;
  adminArea1?: string;
  adminArea2?: string;
  adminArea3?: string;
  adminArea4?: string;
  countryCode: string;
  postalCode?: string;
}

export interface CreateAddressInput {
  addressLine1: string;
  addressLine2?: string;
  addressLine3?: string;
  adminArea1?: string;
  adminArea2?: string;
  adminArea3?: string;
  adminArea4?: string;
  countryCode: string;
  postalCode?: string;
}

export interface MutationCreateLocationInput {
  address: CreateAddressInput;
  label: string;
  name?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
}

export interface CreateLocationResponse {
  createLocation: LocationResponse;
}

export interface LocationResponse {
  id: string;
  label: string | null;
  name: string;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  address?: LocationAddressResponse;
  createdAt: string;
  updatedAt: string;
}

export interface GetLocationsResponse {
  locations: {
    edges: Array<{
      node: LocationResponse;
    }>;
    pageInfo: PageInfo;
    totalCount: number;
  };
}

export type OrderStatus = 'OPEN' | 'COMPLETED' | 'CANCELED' | 'ARCHIVED';
export type PaymentStatus = 'PENDING' | 'AUTHORIZED' | 'PAID' | 'PARTIALLY_PAID' | 'PARTIALLY_REFUNDED' | 'REFUNDED' | 'VOIDED' | 'EXPIRED' | 'FAILED';
export type FulfillmentStatus = 'UNFULFILLED' | 'IN_PROGRESS' | 'FULFILLED' | 'PARTIALLY_FULFILLED' | 'SCHEDULED' | 'ON_HOLD';
export type FulfillmentMode = 'SHIP' | 'PICKUP' | 'DELIVERY';

export interface OrderContext {
  owner?: string;
  channelId: string;
  storeId: string;
  businessId?: string;
  ventureId?: string;
}

export interface OrderStatuses {
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
}

export interface OrderTotal {
  subtotal: SimpleMoney;
  total: SimpleMoney;
  tax: SimpleMoney;
  shipping: SimpleMoney;
  discount: SimpleMoney;
}

export interface OrderLineItem {
  id: string;
  type: string;
  title: string;
  quantity: number;
  price: SimpleMoney;
  total: SimpleMoney;
  sku?: string;
  productId?: string;
  variantId?: string;
}

export interface OrderBilling {
  name?: string;
  email?: string;
  phone?: string;
  address?: CommerceAddress;
}

export interface OrderShipping {
  name?: string;
  email?: string;
  phone?: string;
  address?: CommerceAddress;
  method?: string;
}

export interface Order {
  id: string;
  externalId?: string;
  number: string;
  numberDisplay?: string;
  context: OrderContext;
  statuses: OrderStatuses;
  totals: OrderTotal;
  customerId?: string;
  cartId?: string;
  billing?: OrderBilling;
  shipping?: OrderShipping;
  lineItems: OrderLineItem[];
  fulfillmentModes?: FulfillmentMode[];
  tags?: string[];
  processedAt: string;
  archivedAt?: string;
  canceledAt?: string;
  completedAt?: string;
  paidAt?: string;
  fulfilledAt?: string;
  refundedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GetOrdersResponse {
  status: string;
  orders: Order[];
  links?: Array<{
    rel: string;
    href: string;
  }>;
}

export interface GetOrderResponse {
  status: string;
  order: Order;
}
