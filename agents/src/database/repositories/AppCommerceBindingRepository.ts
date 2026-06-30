import { customAlphabet } from 'nanoid';

import { getDatabase } from '../connection.js';
import type {
  AppCommerceBinding,
  AppCommerceBindingActorType,
  AppCommerceBindingEvent,
  AppCommerceBindingEventType,
  AppCommerceBindingSource,
  AppCommerceBindingStatus,
} from '../schema.js';
import { Logger } from '../../logging/index.js';

const nanoid = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 12);
const logger = Logger.create({ component: 'app-commerce-binding-repository' });

interface AppCommerceBindingRow {
  app_id: string;
  business_id: string | null;
  business_name: string | null;
  store_id: string | null;
  store_name: string | null;
  store_url: string | null;
  channel_id: string | null;
  channel_name: string | null;
  default_location_id: string | null;
  currency_code: string | null;
  status: string;
  source: string;
  last_verified_at: string | null;
  verification_error: string | null;
  created_at: string;
  updated_at: string;
}

interface AppCommerceBindingEventRow {
  id: string;
  app_id: string;
  event_type: string;
  previous_business_id: string | null;
  previous_store_id: string | null;
  previous_channel_id: string | null;
  next_business_id: string | null;
  next_store_id: string | null;
  next_channel_id: string | null;
  actor_type: string;
  reason: string | null;
  metadata: string | null;
  created_at: string;
}

export interface UpsertAppCommerceBindingParams {
  appId: string;
  businessId?: string | null;
  businessName?: string | null;
  storeId?: string | null;
  storeName?: string | null;
  storeUrl?: string | null;
  channelId?: string | null;
  channelName?: string | null;
  defaultLocationId?: string | null;
  currencyCode?: string | null;
  status: AppCommerceBindingStatus;
  source: AppCommerceBindingSource;
  lastVerifiedAt?: Date | string | null;
  verificationError?: string | null;
  eventType?: AppCommerceBindingEventType;
  actorType?: AppCommerceBindingActorType;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface RecordAppCommerceBindingEventParams {
  appId: string;
  eventType: AppCommerceBindingEventType;
  previousBusinessId?: string | null;
  previousStoreId?: string | null;
  previousChannelId?: string | null;
  nextBusinessId?: string | null;
  nextStoreId?: string | null;
  nextChannelId?: string | null;
  actorType: AppCommerceBindingActorType;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

function hasOwn<T extends object>(value: T, key: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function dateOrNull(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

function dateInputToString(value: Date | string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function normalizeCurrencyCode(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

function bindingEventMetadata(
  metadata: Record<string, unknown> | null | undefined,
  previousCurrencyCode: string | null,
  nextCurrencyCode: string | null
): Record<string, unknown> | null {
  const currencyMetadata = {
    previousCurrencyCode,
    nextCurrencyCode,
  };

  return metadata ? { ...metadata, ...currencyMetadata } : currencyMetadata;
}

function parseMetadata(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export class AppCommerceBindingRepository {
  private db = getDatabase();

  findByAppId(appId: string): AppCommerceBinding | null {
    try {
      return this.findByAppIdStrict(appId);
    } catch (error) {
      logger.error('app-commerce-binding.find-by-app.error', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  upsert(params: UpsertAppCommerceBindingParams): AppCommerceBinding {
    try {
      const upsertBinding = this.db.transaction(() => {
        const previous = this.findByAppIdStrict(params.appId);
        const next = {
          appId: params.appId,
          businessId: hasOwn(params, 'businessId') ? params.businessId ?? null : previous?.businessId ?? null,
          businessName: hasOwn(params, 'businessName') ? params.businessName ?? null : previous?.businessName ?? null,
          storeId: hasOwn(params, 'storeId') ? params.storeId ?? null : previous?.storeId ?? null,
          storeName: hasOwn(params, 'storeName') ? params.storeName ?? null : previous?.storeName ?? null,
          storeUrl: hasOwn(params, 'storeUrl') ? params.storeUrl ?? null : previous?.storeUrl ?? null,
          channelId: hasOwn(params, 'channelId') ? params.channelId ?? null : previous?.channelId ?? null,
          channelName: hasOwn(params, 'channelName') ? params.channelName ?? null : previous?.channelName ?? null,
          defaultLocationId: hasOwn(params, 'defaultLocationId')
            ? params.defaultLocationId ?? null
            : previous?.defaultLocationId ?? null,
          currencyCode: hasOwn(params, 'currencyCode')
            ? normalizeCurrencyCode(params.currencyCode)
            : previous?.currencyCode ?? null,
          status: params.status,
          source: params.source,
          lastVerifiedAt: hasOwn(params, 'lastVerifiedAt')
            ? dateInputToString(params.lastVerifiedAt)
            : previous?.lastVerifiedAt?.toISOString() ?? null,
          verificationError: hasOwn(params, 'verificationError')
            ? params.verificationError ?? null
            : previous?.verificationError ?? null,
        };

        this.db
          .prepare(`
            INSERT INTO app_commerce_bindings (
              app_id,
              business_id,
              business_name,
              store_id,
              store_name,
              store_url,
              channel_id,
              channel_name,
              default_location_id,
              currency_code,
              status,
              source,
              last_verified_at,
              verification_error,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(app_id) DO UPDATE SET
              business_id = excluded.business_id,
              business_name = excluded.business_name,
              store_id = excluded.store_id,
              store_name = excluded.store_name,
              store_url = excluded.store_url,
              channel_id = excluded.channel_id,
              channel_name = excluded.channel_name,
              default_location_id = excluded.default_location_id,
              currency_code = excluded.currency_code,
              status = excluded.status,
              source = excluded.source,
              last_verified_at = excluded.last_verified_at,
              verification_error = excluded.verification_error
          `)
          .run(
            next.appId,
            next.businessId,
            next.businessName,
            next.storeId,
            next.storeName,
            next.storeUrl,
            next.channelId,
            next.channelName,
            next.defaultLocationId,
            next.currencyCode,
            next.status,
            next.source,
            next.lastVerifiedAt,
            next.verificationError
          );

        if (params.eventType) {
          this.insertEvent({
            appId: params.appId,
            eventType: params.eventType,
            previousBusinessId: previous?.businessId ?? null,
            previousStoreId: previous?.storeId ?? null,
            previousChannelId: previous?.channelId ?? null,
            nextBusinessId: next.businessId,
            nextStoreId: next.storeId,
            nextChannelId: next.channelId,
            actorType: params.actorType ?? 'agent',
            reason: params.reason,
            metadata: bindingEventMetadata(params.metadata, previous?.currencyCode ?? null, next.currencyCode),
          });
        }

        const binding = this.findByAppIdStrict(params.appId);
        if (!binding) {
          throw new Error('Failed to retrieve upserted app commerce binding');
        }

        return binding;
      });

      const binding = upsertBinding();

      logger.info('app-commerce-binding.upsert.success', {
        appId: params.appId,
        status: binding.status,
        source: binding.source,
        hasBusinessId: Boolean(binding.businessId),
        hasStoreId: Boolean(binding.storeId),
        hasChannelId: Boolean(binding.channelId),
      });

      return binding;
    } catch (error) {
      logger.error('app-commerce-binding.upsert.error', {
        appId: params.appId,
        status: params.status,
        source: params.source,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  clear(
    appId: string,
    actorType: AppCommerceBindingActorType = 'agent',
    reason?: string
  ): boolean {
    const previous = this.findByAppId(appId);

    try {
      const result = this.db
        .prepare(`DELETE FROM app_commerce_bindings WHERE app_id = ?`)
        .run(appId);

      if (previous || result.changes > 0) {
        this.recordEvent({
          appId,
          eventType: 'cleared_binding',
          previousBusinessId: previous?.businessId ?? null,
          previousStoreId: previous?.storeId ?? null,
          previousChannelId: previous?.channelId ?? null,
          nextBusinessId: null,
          nextStoreId: null,
          nextChannelId: null,
          actorType,
          reason,
        });
      }

      return result.changes > 0;
    } catch (error) {
      logger.error('app-commerce-binding.clear.error', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  listEventsByAppId(appId: string, limit = 20): AppCommerceBindingEvent[] {
    try {
      const rows = this.db
        .prepare(`
          SELECT * FROM app_commerce_binding_events
          WHERE app_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `)
        .all(appId, limit) as AppCommerceBindingEventRow[];

      return rows.map((row) => this.mapRowToEvent(row));
    } catch (error) {
      logger.error('app-commerce-binding.events-by-app.error', {
        appId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  recordEvent(params: RecordAppCommerceBindingEventParams): AppCommerceBindingEvent {
    try {
      return this.insertEvent(params);
    } catch (error) {
      logger.error('app-commerce-binding.record-event.error', {
        appId: params.appId,
        eventType: params.eventType,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private findByAppIdStrict(appId: string): AppCommerceBinding | null {
    const row = this.db
      .prepare(`SELECT * FROM app_commerce_bindings WHERE app_id = ?`)
      .get(appId) as AppCommerceBindingRow | undefined;

    return row ? this.mapRowToBinding(row) : null;
  }

  private insertEvent(params: RecordAppCommerceBindingEventParams): AppCommerceBindingEvent {
    const id = `commerce-binding-${nanoid()}`;
    const metadata = params.metadata ? JSON.stringify(params.metadata) : null;

    this.db
      .prepare(`
        INSERT INTO app_commerce_binding_events (
          id,
          app_id,
          event_type,
          previous_business_id,
          previous_store_id,
          previous_channel_id,
          next_business_id,
          next_store_id,
          next_channel_id,
          actor_type,
          reason,
          metadata
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        params.appId,
        params.eventType,
        params.previousBusinessId ?? null,
        params.previousStoreId ?? null,
        params.previousChannelId ?? null,
        params.nextBusinessId ?? null,
        params.nextStoreId ?? null,
        params.nextChannelId ?? null,
        params.actorType,
        params.reason ?? null,
        metadata
      );

    const row = this.db
      .prepare(`SELECT * FROM app_commerce_binding_events WHERE id = ?`)
      .get(id) as AppCommerceBindingEventRow | undefined;

    if (!row) {
      throw new Error('Failed to retrieve created app commerce binding event');
    }

    return this.mapRowToEvent(row);
  }

  private mapRowToBinding(row: AppCommerceBindingRow): AppCommerceBinding {
    return {
      appId: row.app_id,
      businessId: row.business_id,
      businessName: row.business_name,
      storeId: row.store_id,
      storeName: row.store_name,
      storeUrl: row.store_url,
      channelId: row.channel_id,
      channelName: row.channel_name,
      defaultLocationId: row.default_location_id,
      currencyCode: row.currency_code,
      status: row.status as AppCommerceBindingStatus,
      source: row.source as AppCommerceBindingSource,
      lastVerifiedAt: dateOrNull(row.last_verified_at),
      verificationError: row.verification_error,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  private mapRowToEvent(row: AppCommerceBindingEventRow): AppCommerceBindingEvent {
    return {
      id: row.id,
      appId: row.app_id,
      eventType: row.event_type as AppCommerceBindingEventType,
      previousBusinessId: row.previous_business_id,
      previousStoreId: row.previous_store_id,
      previousChannelId: row.previous_channel_id,
      nextBusinessId: row.next_business_id,
      nextStoreId: row.next_store_id,
      nextChannelId: row.next_channel_id,
      actorType: row.actor_type as AppCommerceBindingActorType,
      reason: row.reason,
      metadata: parseMetadata(row.metadata),
      createdAt: new Date(row.created_at),
    };
  }
}
