/**
 * support-db.ts — DynamoDB-backed Jira/support ticket store.
 * All functions are async; signatures compatible with prior SQLite version.
 */

export type { Ticket, TicketStats } from '@/lib/supportplane-store/support-store';

import { getSupportStore } from '@/lib/supportplane-store/support-store';
import type { Ticket, TicketStats } from '@/lib/supportplane-store/support-store';

export async function upsertTicket(ticket: Ticket): Promise<void> {
  return getSupportStore().upsertTicket(ticket);
}

export async function upsertTickets(tickets: Ticket[]): Promise<void> {
  return getSupportStore().upsertTickets(tickets);
}

export async function getTicketStats(): Promise<TicketStats> {
  return getSupportStore().getTicketStats();
}

export async function listTickets(filters?: {
  status?: string;
  priority?: string;
  assignee?: string;
  project?: string;
  limit?: number;
  offset?: number;
}): Promise<Ticket[]> {
  return getSupportStore().listTickets(filters);
}

export async function getLastSyncTime(source: string): Promise<string | null> {
  return getSupportStore().getLastSyncTime(source);
}

export async function setLastSyncTime(source: string, timestamp: string): Promise<void> {
  return getSupportStore().setLastSyncTime(source, timestamp);
}
