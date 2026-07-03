import {
  boolean,
  date,
  datetime,
  decimal,
  double,
  index,
  int,
  longtext,
  mediumtext,
  mysqlTable,
  text,
  tinyint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { generateId } from "./uuid";
import { sql } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Account Metrics
// ---------------------------------------------------------------------------

export const accountMetric = mysqlTable("account_metric", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => generateId()),
  event: varchar("event", { length: 255 }),
  value: varchar("value", { length: 255 }),
  oldValue: varchar("old_value", { length: 255 }),
  createdAt: datetime("created_at").notNull(),
  updatedAt: datetime("updated_at").notNull(),
});

// ---------------------------------------------------------------------------
// Booked Instances
// ---------------------------------------------------------------------------

export const bookedInstance = mysqlTable(
  "booked_instance",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    serviceId: varchar("service_id", { length: 36 }).notNull(),
    staffId: varchar("staff_id", { length: 36 }),
    paidAmount: decimal("paid_amount", { precision: 10, scale: 2 }).default("0.00"),
    startTime: datetime("start_time"),
    endTime: datetime("end_time"),
    endTimeDisplay: datetime("end_time_display"),
    maxCapacity: int("max_capacity").notNull().default(0),
    remainingCapacity: int("remaining_capacity").notNull().default(0),
    teleconferenceUrl: varchar("teleconference_url", { length: 255 }),
    createdAt: datetime("created_at"),
    updatedAt: datetime("updated_at"),
    lockVersion: int("lock_version").default(0),
  },
  (table) => [
    uniqueIndex("idx_booked_instance_service_staff_time").on(
      table.serviceId,
      table.staffId,
      table.startTime,
    ),
    index("idx_booked_instance_time_capacity").on(
      table.startTime,
      table.endTime,
      table.remainingCapacity,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

export const booking = mysqlTable(
  "booking",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    bookableId: varchar("bookable_id", { length: 36 }),
    bookableType: varchar("bookable_type", { length: 255 }),
    bookerId: varchar("booker_id", { length: 36 }),
    bookerType: varchar("booker_type", { length: 255 }),
    bookedBy: varchar("booked_by", { length: 255 }),
    rescheduleCount: int("reschedule_count").notNull().default(0),
    lastRescheduledAt: datetime("last_rescheduled_at"),
    lastRescheduledBy: varchar("last_rescheduled_by", { length: 255 }),
    serviceSnapshotId: varchar("service_snapshot_id", { length: 36 }),
    bookedInstanceId: varchar("booked_instance_id", { length: 36 }),
    quantity: int("quantity"),
    startTime: datetime("start_time"),
    endTime: datetime("end_time"),
    endTimeDisplay: datetime("end_time_display"),
    status: varchar("status", { length: 255 }).default("unpaid"),
    statusBeforeBackfill: varchar("status_before_backfill", { length: 255 }),
    paidDate: datetime("paid_date"),
    paidAmount: decimal("paid_amount", { precision: 10, scale: 2 }).default("0.00"),
    currency: varchar("currency", { length: 3 }).notNull().default("USD"),
    paidAmountUpdatedAt: datetime("paid_amount_updated_at"),
    extContactId: varchar("ext_contact_id", { length: 255 }),
    c2Auth: boolean("c2_auth").notNull().default(false),
    couponCode: varchar("coupon_code", { length: 50 }),
    discountAmount: decimal("discount_amount", { precision: 10, scale: 2 }).default("0.00"),
    confirmationCode: varchar("confirmation_code", { length: 12 }),
    paymentSessionId: varchar("payment_session_id", { length: 255 }),
    paymentTransactionId: varchar("payment_transaction_id", { length: 255 }),
    createdAt: datetime("created_at"),
    updatedAt: datetime("updated_at"),
    deletedAt: datetime("deleted_at"),
  },
  (table) => [
    index("idx_booking_booked_instance").on(table.bookedInstanceId),
    index("idx_booking_deleted").on(table.deletedAt),
    index("idx_booking_membership").on(table.extContactId, table.c2Auth),
    index("idx_booking_bookable").on(table.bookableType, table.bookableId),
    index("idx_booking_booker").on(table.bookerType, table.bookerId),
    index("idx_booking_start_end_time").on(table.startTime, table.endTime),
    index("idx_booking_payment_session").on(table.paymentSessionId),
  ],
);

// ---------------------------------------------------------------------------
// Booking Staff (junction)
// ---------------------------------------------------------------------------

export const bookingStaff = mysqlTable(
  "booking_staff",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    bookingId: varchar("booking_id", { length: 36 }).notNull(),
    staffId: varchar("staff_id", { length: 36 }).notNull(),
    createdAt: datetime("created_at").notNull(),
    updatedAt: datetime("updated_at").notNull(),
  },
  (table) => [
    index("idx_booking_staff_booking").on(table.bookingId, table.staffId),
    index("idx_booking_staff_staff").on(table.staffId, table.bookingId),
  ],
);

// ---------------------------------------------------------------------------
// Business Settings
// ---------------------------------------------------------------------------

export const businessSetting = mysqlTable(
  "business_setting",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    key: varchar("key", { length: 255 }),
    value: mediumtext("value"),
    createdAt: datetime("created_at").notNull(),
    updatedAt: datetime("updated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_business_setting_key").on(table.key)],
);

export const businessSettingMetric = mysqlTable("business_setting_metric", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => generateId()),
  event: varchar("event", { length: 255 }),
  key: varchar("key", { length: 255 }).notNull(),
  value: varchar("value", { length: 255 }),
  oldValue: varchar("old_value", { length: 255 }),
  createdAt: datetime("created_at").notNull(),
  updatedAt: datetime("updated_at").notNull(),
});

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const category = mysqlTable(
  "category",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    name: varchar("name", { length: 255 }),
    permanent: boolean("permanent").notNull().default(false),
    permalink: varchar("permalink", { length: 255 }),
    description: mediumtext("description"),
    metaTitle: varchar("meta_title", { length: 255 }),
    metaDescription: varchar("meta_description", { length: 255 }),
    metaKeywords: varchar("meta_keywords", { length: 255 }),
    createdAt: datetime("created_at").notNull(),
    updatedAt: datetime("updated_at").notNull(),
    parentId: varchar("parent_id", { length: 36 }),
    lft: int("lft").notNull(),
    rgt: int("rgt").notNull(),
    depth: int("depth").notNull().default(0),
    childrenCount: int("children_count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("idx_category_name").on(table.name),
    index("idx_category_lft").on(table.lft),
    index("idx_category_parent_id").on(table.parentId),
    index("idx_category_rgt").on(table.rgt),
  ],
);

export const categoryService = mysqlTable(
  "category_service",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    categoryId: varchar("category_id", { length: 36 }),
    serviceId: varchar("service_id", { length: 36 }),
    createdAt: datetime("created_at").notNull(),
    updatedAt: datetime("updated_at").notNull(),
    parentId: varchar("parent_id", { length: 36 }),
    lft: int("lft").notNull().default(0),
    rgt: int("rgt").notNull().default(0),
  },
  (table) => [
    index("idx_category_service_category").on(table.categoryId, table.serviceId),
    index("idx_category_service_service").on(table.serviceId, table.categoryId),
  ],
);

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export const client = mysqlTable(
  "client",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    firstName: varchar("first_name", { length: 255 }),
    lastName: varchar("last_name", { length: 255 }),
    deletedAt: datetime("deleted_at"),
    createdAt: datetime("created_at").notNull(),
    updatedAt: datetime("updated_at").notNull(),
    notes: mediumtext("notes"),
  },
  (table) => [index("idx_client_deleted").on(table.deletedAt)],
);

// ---------------------------------------------------------------------------
// Contact Details
// ---------------------------------------------------------------------------

export const contactDetail = mysqlTable(
  "contact_detail",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    contactableId: varchar("contactable_id", { length: 36 }),
    contactableType: varchar("contactable_type", { length: 255 }),
    email: varchar("email", { length: 255 }),
    phoneNumber: varchar("phone_number", { length: 255 }),
    address1: varchar("address_1", { length: 255 }),
    address2: varchar("address_2", { length: 255 }),
    city: varchar("city", { length: 255 }),
    postalCode: varchar("postal_code", { length: 255 }),
    deletedAt: datetime("deleted_at"),
    createdAt: datetime("created_at").notNull(),
    updatedAt: datetime("updated_at").notNull(),
    stateId: int("state_id"),
    countryId: int("country_id"),
  },
  (table) => [
    index("idx_contact_detail_contactable").on(table.contactableType, table.contactableId),
    index("idx_contact_detail_deleted").on(table.deletedAt),
    index("idx_contact_detail_country_id").on(table.countryId),
    index("idx_contact_detail_state_id").on(table.stateId),
  ],
);

// ---------------------------------------------------------------------------
// Countries & States
// ---------------------------------------------------------------------------

export const country = mysqlTable("country", {
  id: int("id", { unsigned: true }).primaryKey().autoincrement(),
  isoName: varchar("iso_name", { length: 255 }),
  iso: varchar("iso", { length: 255 }),
  iso3: varchar("iso3", { length: 255 }),
  name: varchar("name", { length: 255 }),
  numcode: int("numcode"),
  statesRequired: boolean("states_required"),
  postalCodesRequired: boolean("postal_codes_required").notNull().default(true),
  citiesRequired: boolean("cities_required").notNull().default(true),
  enabled: boolean("enabled").default(false),
  createdAt: datetime("created_at"),
  updatedAt: datetime("updated_at"),
});

export const state = mysqlTable(
  "state",
  {
    id: int("id", { unsigned: true }).primaryKey().autoincrement(),
    name: varchar("name", { length: 255 }),
    abbr: varchar("abbr", { length: 255 }),
    countryId: int("country_id"),
    createdAt: datetime("created_at"),
    updatedAt: datetime("updated_at"),
  },
  (table) => [index("idx_state_country_id").on(table.countryId)],
);

// ---------------------------------------------------------------------------
// Exception Times
// ---------------------------------------------------------------------------

export const exceptionTime = mysqlTable(
  "exception_time",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    staffId: varchar("staff_id", { length: 36 }),
    exceptionableId: varchar("exceptionable_id", { length: 36 }),
    title: varchar("title", { length: 255 }),
    exceptionableType: varchar("exceptionable_type", { length: 255 }),
    startTime: datetime("start_time"),
    endTime: datetime("end_time"),
    extId: varchar("ext_id", { length: 255 }),
    description: mediumtext("description"),
    extCalId: varchar("ext_cal_id", { length: 255 }),
    createdAt: datetime("created_at").notNull(),
    updatedAt: datetime("updated_at").notNull(),
    recurrenceType: varchar("recurrence_type", { length: 255 }),
    schedule: mediumtext("schedule"),
    recurrenceLimit: int("recurrence_limit"),
    recurrenceEndTime: datetime("recurrence_end_time"),
  },
  (table) => [
    index("idx_exception_time_exceptionable_time").on(
      table.exceptionableId,
      table.startTime,
      table.endTime,
      table.extId,
    ),
    index("idx_exception_time_exceptionable").on(table.exceptionableType, table.exceptionableId),
    index("idx_exception_time_ext_cal_id").on(table.extCalId),
    uniqueIndex("idx_exception_time_ext_id").on(table.extId),
    index("idx_exception_time_staff_id").on(table.staffId),
  ],
);

// ---------------------------------------------------------------------------
// External OAuth
// ---------------------------------------------------------------------------

export const externalOauth = mysqlTable(
  "external_oauth",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    providerName: varchar("provider_name", { length: 255 }).notNull(),
    extId: varchar("ext_id", { length: 255 }).notNull(),
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token").notNull(),
    config: longtext("config"),
    createdAt: datetime("created_at").notNull(),
    updatedAt: datetime("updated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_external_oauth_provider").on(table.providerName)],
);

// ---------------------------------------------------------------------------
// GoCentral Webhooks
// ---------------------------------------------------------------------------

export const gocentralWebhook = mysqlTable(
  "gocentral_webhook",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    webhookId: varchar("webhook_id", { length: 255 }),
    webhookType: varchar("webhook_type", { length: 255 }),
    createdAt: datetime("created_at").notNull(),
    updatedAt: datetime("updated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_gocentral_webhook_type").on(table.webhookType)],
);

// ---------------------------------------------------------------------------
// Reminders
// ---------------------------------------------------------------------------

export const reminder = mysqlTable(
  "reminder",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    bookingId: varchar("booking_id", { length: 36 }).notNull(),
    deliveryMethod: varchar("delivery_method", { length: 255 }),
    status: varchar("status", { length: 255 }),
    performAt: datetime("perform_at"),
    createdAt: datetime("created_at").notNull(),
    updatedAt: datetime("updated_at").notNull(),
  },
  (table) => [
    index("idx_reminder_booking_id").on(table.bookingId),
    index("idx_reminder_perform_at_status").on(table.performAt, table.status),
  ],
);

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

export const staff = mysqlTable(
  "staff",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    name: varchar("name", { length: 255 }),
    role: varchar("role", { length: 255 }).notNull().default("generic"),
    deletedAt: datetime("deleted_at"),
    createdAt: datetime("created_at").notNull(),
    updatedAt: datetime("updated_at").notNull(),
  },
  (table) => [
    index("idx_staff_deleted").on(table.deletedAt),
    index("idx_staff_role").on(table.role),
  ],
);

export const staffSetting = mysqlTable(
  "staff_setting",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    staffId: varchar("staff_id", { length: 36 }).notNull(),
    key: varchar("key", { length: 255 }),
    value: mediumtext("value"),
    deletedAt: datetime("deleted_at"),
    createdAt: datetime("created_at").notNull(),
    updatedAt: datetime("updated_at").notNull(),
  },
  (table) => [
    index("idx_staff_setting_deleted").on(table.deletedAt),
    uniqueIndex("idx_staff_setting_staff_key").on(table.staffId, table.key),
  ],
);

export const serviceStaff = mysqlTable(
  "service_staff",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    serviceId: varchar("service_id", { length: 36 }).notNull(),
    staffId: varchar("staff_id", { length: 36 }).notNull(),
    availability: mediumtext("availability"),
    createdAt: datetime("created_at").notNull(),
    updatedAt: datetime("updated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_service_staff_staff_service").on(table.staffId, table.serviceId)],
);

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

export const service = mysqlTable(
  "service",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    name: varchar("name", { length: 255 }),
    slug: varchar("slug", { length: 255 }),
    description: mediumtext("description"),
    locationType: varchar("location_type", { length: 255 }),
    customLocationText: mediumtext("custom_location_text"),
    locationUrl: varchar("location_url", { length: 512 }),
    locationUrlNotes: mediumtext("location_url_notes"),
    teleconferenceProvider: varchar("teleconference_provider", {
      length: 255,
    }),
    costType: varchar("cost_type", { length: 255 }),
    cost: decimal("cost", { precision: 10, scale: 2 }),
    salesPrice: decimal("sales_price", { precision: 10, scale: 2 }),
    paymentOption: varchar("payment_option", { length: 255 }),
    depositAmount: decimal("deposit_amount", {
      precision: 10,
      scale: 2,
    }).default("0.00"),
    customCostText: varchar("custom_cost_text", { length: 255 }),
    startTime: datetime("start_time"),
    endTime: datetime("end_time"),
    duration: varchar("duration", { length: 255 }),
    bufferTime: varchar("buffer_time", { length: 255 }).notNull().default("PT0M"),
    bookLeadTime: varchar("book_lead_time", { length: 255 }).notNull().default("PT0M"),
    cancelLeadTime: int("cancel_lead_time"),
    schedule: mediumtext("schedule"),
    recurrenceType: varchar("recurrence_type", { length: 255 }),
    capacity: int("capacity"),
    imageUrl: varchar("image_url", { length: 512 }),
    c2CanReschedule: boolean("c2_can_reschedule").notNull().default(false),
    currentSnapshotId: varchar("current_snapshot_id", { length: 36 }),
    staffRole: varchar("staff_role", { length: 100 }),
    visible: boolean("visible").default(true),
    deletedAt: datetime("deleted_at"),
    createdAt: datetime("created_at").notNull(),
    updatedAt: datetime("updated_at").notNull(),
    recurrenceLimit: int("recurrence_limit"),
  },
  (table) => [
    index("idx_service_deleted").on(table.deletedAt),
    index("idx_service_recurrence").on(table.recurrenceType),
    uniqueIndex("idx_service_slug").on(table.slug),
    index("idx_service_start_end_time").on(table.startTime, table.endTime),
  ],
);

// ---------------------------------------------------------------------------
// Service Snapshots
// ---------------------------------------------------------------------------

export const serviceSnapshot = mysqlTable("service_snapshot", {
  id: varchar("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => generateId()),
  serviceId: varchar("service_id", { length: 36 }).notNull(),
  name: varchar("name", { length: 255 }),
  slug: varchar("slug", { length: 255 }),
  description: mediumtext("description"),
  locationType: varchar("location_type", { length: 255 }),
  customLocationText: mediumtext("custom_location_text"),
  locationUrl: varchar("location_url", { length: 512 }),
  locationUrlNotes: mediumtext("location_url_notes"),
  teleconferenceProvider: varchar("teleconference_provider", {
    length: 255,
  }),
  costType: varchar("cost_type", { length: 255 }),
  cost: decimal("cost", { precision: 10, scale: 2 }),
  salesPrice: decimal("sales_price", { precision: 10, scale: 2 }),
  paymentOption: varchar("payment_option", { length: 255 }),
  depositAmount: decimal("deposit_amount", {
    precision: 10,
    scale: 2,
  }).default("0.00"),
  customCostText: varchar("custom_cost_text", { length: 255 }),
  startTime: datetime("start_time"),
  endTime: datetime("end_time"),
  duration: varchar("duration", { length: 255 }),
  bufferTime: varchar("buffer_time", { length: 255 }).notNull().default("PT0M"),
  bookLeadTime: varchar("book_lead_time", { length: 255 }).notNull().default("PT0M"),
  cancelLeadTime: int("cancel_lead_time"),
  schedule: mediumtext("schedule"),
  recurrenceType: varchar("recurrence_type", { length: 255 }),
  capacity: int("capacity"),
  imageUrl: varchar("image_url", { length: 512 }),
  c2CanReschedule: boolean("c2_can_reschedule").notNull().default(false),
  visible: boolean("visible").default(true),
  deletedAt: datetime("deleted_at"),
  createdAt: datetime("created_at").notNull(),
  updatedAt: datetime("updated_at").notNull(),
  recurrenceLimit: int("recurrence_limit"),
});

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export const question = mysqlTable(
  "question",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    body: mediumtext("body").notNull(),
    required: boolean("required").notNull().default(false),
    lft: int("lft").notNull(),
    deletedAt: datetime("deleted_at"),
    createdAt: datetime("created_at").notNull(),
    updatedAt: datetime("updated_at").notNull(),
  },
  (table) => [index("idx_question_deleted").on(table.deletedAt)],
);

// ---------------------------------------------------------------------------
// Answered Questions
// ---------------------------------------------------------------------------

export const answeredQuestion = mysqlTable(
  "answered_question",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    bookingId: varchar("booking_id", { length: 36 }).notNull(),
    questionId: varchar("question_id", { length: 36 }).notNull(),
    body: mediumtext("body"),
    deletedAt: datetime("deleted_at"),
    createdAt: datetime("created_at").notNull(),
    updatedAt: datetime("updated_at").notNull(),
  },
  (table) => [
    index("idx_answered_question_booking").on(table.bookingId),
    index("idx_answered_question_question").on(table.questionId),
  ],
);

// ---------------------------------------------------------------------------
// User Credentials
// Stores hashed credentials (local provider) or external UIDs (OAuth).
// Keyed by (identityId, identityType, provider) — one credential per
// identity per provider. Identity types: 'Client' | 'Staff' | 'Admin'.
// ---------------------------------------------------------------------------

export const userCredential = mysqlTable(
  "user_credential",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    identityId: varchar("identity_id", { length: 36 }).notNull(),
    identityType: varchar("identity_type", { length: 50 }).notNull(),
    provider: varchar("provider", { length: 50 }).notNull().default("local"),
    credentialHash: varchar("credential_hash", { length: 512 }),
    providerUid: varchar("provider_uid", { length: 512 }),
    createdAt: datetime("created_at").notNull(),
    updatedAt: datetime("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("uniq_identity_provider").on(table.identityId, table.identityType, table.provider),
    index("idx_credential_provider_uid").on(table.provider, table.providerUid),
  ],
);

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

export const coupons = mysqlTable(
  "coupons",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    code: varchar({ length: 255 }).notNull(),
    type: varchar({ length: 255 }).notNull(),
    minimumCartValue: double("minimum_cart_value", {
      unsigned: true,
    }).notNull(),
    discountPrice: double("discount_price", { unsigned: true }),
    discountPercentage: tinyint("discount_percentage", { unsigned: true }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    limitUses: boolean("limit_uses").default(false),
    limit: int({ unsigned: true }),
    currentUsage: int("current_usage", { unsigned: true }),
    isActive: boolean("is_active").default(true),
    createdAt: datetime("created_at").default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime("updated_at").default(sql`CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`),
    deletedAt: datetime("deleted_at"),
  },
  (table) => [
    uniqueIndex("unique_coupons_code").on(table.code),
    index("coupons_is_active_idx").on(table.isActive),
    index("coupons_code_idx").on(table.code),
  ],
);

// Type inference for coupons table
export type Coupon = typeof coupons.$inferSelect;

// ---------------------------------------------------------------------------
// Transaction (provider-agnostic payment record)
// ---------------------------------------------------------------------------

export const transaction = mysqlTable(
  "transaction",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    bookingId: varchar("booking_id", { length: 36 }).notNull(),
    provider: varchar("provider", { length: 50 }).notNull(),
    type: varchar("type", { length: 50 }).notNull(),
    status: varchar("status", { length: 50 }).notNull(),
    amount: int("amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    transactionId: varchar("transaction_id", { length: 255 }),
    sessionId: varchar("session_id", { length: 255 }),
    paymentMethod: varchar("payment_method", { length: 50 }),
    createdAt: datetime("created_at").notNull(),
    updatedAt: datetime("updated_at").notNull(),
  },
  (table) => [
    index("idx_transaction_booking").on(table.bookingId),
    index("idx_transaction_session").on(table.sessionId),
    index("idx_transaction_txn").on(table.transactionId),
  ],
);

// ---------------------------------------------------------------------------
// Payment Provider (which providers are configured and enabled)
// ---------------------------------------------------------------------------

export const paymentProvider = mysqlTable(
  "payment_provider",
  {
    id: varchar("id", { length: 36 })
      .primaryKey()
      .$defaultFn(() => generateId()),
    provider: varchar("provider", { length: 50 }).notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: datetime("created_at").notNull(),
    updatedAt: datetime("updated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_payment_provider_provider").on(table.provider)],
);
