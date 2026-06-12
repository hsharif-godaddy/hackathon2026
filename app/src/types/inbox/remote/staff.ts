import { BasicEntity, EmailString, Nullable } from '@/types/inbox/local/core';

export interface RemoteStaff extends BasicEntity {
  notification_email: Nullable<EmailString>,
}
