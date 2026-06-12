import { Staff } from '@/types/inbox/local/staff';
import { RemoteStaff } from '@/types/inbox/remote/staff';

export const convertStaff = (staff: RemoteStaff): Staff => {
  return {
    id: staff.id,
    notificationEmail: staff.notification_email,
  };
};
