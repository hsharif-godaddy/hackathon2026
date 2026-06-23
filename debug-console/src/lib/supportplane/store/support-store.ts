import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';

import { buildDynamoClient, getConfig } from '@/lib/supportplane/store/config';

export interface Ticket {
  ticket_key: string;
  created_utc: string;
  updated_utc?: string;
  resolved_utc?: string;
  status?: string;
  issue_type?: string;
  priority?: string;
  assignee?: string;
  rating?: number;
  mttr_hours?: number;
  summary?: string;
  description?: string;
  labels?: string;
  project?: string;
  meta_json?: string;
}

export interface TicketStats {
  total: number;
  open: number;
  resolved: number;
  mean_mttr_hours?: number;
  median_mttr_hours?: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  by_assignee: Record<string, number>;
}

let client: DynamoDBDocumentClient | null = null;

function getClient(): DynamoDBDocumentClient {
  if (client) return client;
  client = buildDynamoClient();
  return client;
}

const META_LAST_SYNC_PREFIX = '__meta__#last_sync#';

async function scanAll(tableName: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const page = await getClient().send(
      new ScanCommand({ TableName: tableName, ExclusiveStartKey: start })
    );
    for (const item of page.Items || []) {
      rows.push(item as Record<string, unknown>);
    }
    start = page.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (start);
  return rows;
}

export class SupportStore {
  private ticketsTable(): string { return getConfig().ticketsTable; }

  async upsertTicket(ticket: Ticket): Promise<void> {
    await getClient().send(
      new PutCommand({ TableName: this.ticketsTable(), Item: ticket })
    );
  }

  async upsertTickets(tickets: Ticket[]): Promise<void> {
    const chunks: Ticket[][] = [];
    for (let i = 0; i < tickets.length; i += 25) {
      chunks.push(tickets.slice(i, i + 25));
    }
    for (const chunk of chunks) {
      await getClient().send(
        new BatchWriteCommand({
          RequestItems: {
            [this.ticketsTable()]: chunk.map((t) => ({ PutRequest: { Item: t } })),
          },
        })
      );
    }
  }

  async listTickets(filters?: {
    status?: string;
    priority?: string;
    assignee?: string;
    project?: string;
    limit?: number;
    offset?: number;
  }): Promise<Ticket[]> {
    const all = (await scanAll(this.ticketsTable())).filter(
      (i) => !String(i['ticket_key'] ?? '').startsWith('__meta__')
    ) as unknown as Ticket[];

    let rows = all;
    if (filters?.status) rows = rows.filter((t) => t.status === filters.status);
    if (filters?.priority) rows = rows.filter((t) => t.priority === filters.priority);
    if (filters?.assignee) rows = rows.filter((t) => t.assignee === filters.assignee);
    if (filters?.project) rows = rows.filter((t) => t.project === filters.project);

    rows.sort((a, b) =>
      String(b.created_utc ?? '').localeCompare(String(a.created_utc ?? ''))
    );

    const offset = filters?.offset ?? 0;
    const limit = filters?.limit ?? rows.length;
    return rows.slice(offset, offset + limit);
  }

  async getTicketStats(): Promise<TicketStats> {
    const all = (await scanAll(this.ticketsTable())).filter(
      (i) => !String(i['ticket_key'] ?? '').startsWith('__meta__')
    ) as unknown as Ticket[];

    const resolved = new Set(['Done', 'Closed']);
    let openCount = 0, resolvedCount = 0;
    const mttrValues: number[] = [];
    const byStatus = new Map<string, number>();
    const byPriority = new Map<string, number>();
    const byAssignee = new Map<string, number>();

    for (const t of all) {
      if (resolved.has(t.status ?? '')) resolvedCount++;
      else openCount++;
      if (typeof t.mttr_hours === 'number') mttrValues.push(t.mttr_hours);
      if (t.status) byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);
      if (t.priority) byPriority.set(t.priority, (byPriority.get(t.priority) ?? 0) + 1);
      if (t.assignee) byAssignee.set(t.assignee, (byAssignee.get(t.assignee) ?? 0) + 1);
    }

    mttrValues.sort((a, b) => a - b);
    const mean = mttrValues.length
      ? mttrValues.reduce((s, v) => s + v, 0) / mttrValues.length
      : undefined;
    const median = mttrValues.length
      ? mttrValues[Math.floor(mttrValues.length / 2)]
      : undefined;

    // Top 20 assignees by count
    const topAssignees = [...byAssignee.entries()]
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20);

    return {
      total: all.length,
      open: openCount,
      resolved: resolvedCount,
      mean_mttr_hours: mean,
      median_mttr_hours: median,
      by_status: Object.fromEntries(byStatus),
      by_priority: Object.fromEntries(byPriority),
      by_assignee: Object.fromEntries(topAssignees),
    };
  }

  async getLastSyncTime(source: string): Promise<string | null> {
    const res = await getClient().send(
      new GetCommand({
        TableName: this.ticketsTable(),
        Key: { ticket_key: `${META_LAST_SYNC_PREFIX}${source}` },
      })
    );
    return (res.Item?.['value'] as string) ?? null;
  }

  async setLastSyncTime(source: string, timestamp: string): Promise<void> {
    await getClient().send(
      new PutCommand({
        TableName: this.ticketsTable(),
        Item: {
          ticket_key: `${META_LAST_SYNC_PREFIX}${source}`,
          value: timestamp,
          updated_at: new Date().toISOString(),
        },
      })
    );
  }
}

let store: SupportStore | null = null;

export function getSupportStore(): SupportStore {
  if (!store) store = new SupportStore();
  return store;
}
