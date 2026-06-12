import { BasicEntity, EmailString, Nullable } from '@/types/inbox/local/core';

export interface Staff extends BasicEntity {
  readonly notificationEmail: Nullable<EmailString>
}
