import type { AiroDomainDnsOwnershipResponse } from '@/lib/mgmt-airo/types';

export enum DomainOrigin {
  INTERNAL = 'INTERNAL',
  EXTERNAL = 'EXTERNAL',
}

const DKIM_ROTATION_MONTHS = 6;

export function getNextRotationDate(months: number = DKIM_ROTATION_MONTHS, jitterDays: number = 14): string {
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  const jitterMs = (Math.random() * 2 - 1) * jitterDays * 24 * 60 * 60 * 1000;
  return new Date(date.getTime() + jitterMs).toISOString();
}

export function deriveDomainOrigin(ownership: AiroDomainDnsOwnershipResponse): DomainOrigin {
  return ownership.isGoDaddyDns ? DomainOrigin.INTERNAL : DomainOrigin.EXTERNAL;
}
