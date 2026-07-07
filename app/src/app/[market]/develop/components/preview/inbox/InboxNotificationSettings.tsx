'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import Button from '@ux/button';
import Growl from '@ux/growl';
import BellIcon from '@ux/icon/bell';
import ChevronLeftIcon from '@ux/icon/chevron-left';
import ChevronRightIcon from '@ux/icon/chevron-right';
import text from '@ux/text';
import TextInput from '@ux/text-input';
import ToggleButton from '@ux/toggle-button';

import { useTranslations } from '@/hooks/useTranslations';
import { Popover, PopoverContent, PopoverTrigger } from '@/lib/shadcn/popover';
import { UuidString } from '@/types/inbox/local/core';
import { slideMotionProps, slideTransition } from './slideView';
import {
  useInboxEmailNotifications,
  useInboxStaff,
  useUpdateEmailNotifications,
  useUpdateStaffNotificationEmail,
} from '../../../hooks/useInbox';

// Pragmatic client-side format guard: requires a single `@` with non-empty,
// whitespace-free local and domain parts and a dotted domain. This is a cheap
// pre-flight to avoid round-tripping obvious garbage to Reamaze (whose own
// format check is skipped for Airo Builder apps); the server remains the
// authority on what it ultimately accepts.
const EMAIL_FORMAT_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type NotificationSettingsView = 'list' | 'edit-email';

interface InboxNotificationSettingsProps {
  brandId: UuidString;
  disabled?: boolean;
}

export function InboxNotificationSettings({ brandId, disabled }: InboxNotificationSettingsProps) {
  const [open, setOpen] = useState(false);
  const t = useTranslations();
  const [view, setView] = useState<NotificationSettingsView>('list');
  const [direction, setDirection] = useState(1);
  const [draftEmail, setDraftEmail] = useState('');
  const [panelHeight, setPanelHeight] = useState<number>();
  const [panelWidth, setPanelWidth] = useState<number>();
  const [animateHeight, setAnimateHeight] = useState(false);

  // Server state lives in the React Query cache; only fetch while the popover is
  // open. The cache is the source of truth — no copying into local state.
  const { data: staff, isLoading: isStaffLoading } = useInboxStaff(brandId, { enabled: open });
  const { data: emailNotificationsData, isLoading: isEmailNotificationsLoading } =
    useInboxEmailNotifications(brandId, { enabled: open });
  const updateEmailNotifications = useUpdateEmailNotifications(brandId);
  const updateStaffNotificationEmail = useUpdateStaffNotificationEmail(brandId);

  const notificationEmail = staff?.notificationEmail ?? '';
  const emailNotifications = emailNotificationsData?.emailNotifications ?? false;

  // Measure the entering view's natural width and height as it mounts. The view
  // is absolutely positioned (so views can slide-crossfade), so it contributes
  // nothing to the panel's box — the panel animates to these measured values
  // instead. The inner view sizes to its content within a min/max bound, so the
  // panel accommodates any title/language up to the cap. Each navigation
  // remounts the active branch (including a return to `list` after a save, which
  // may have a longer email subtitle), so the size stays current without a
  // ResizeObserver.
  const measureActiveView = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      setPanelHeight(node.offsetHeight);
      setPanelWidth(node.offsetWidth);
    }
  }, []);

  // Skip animating the first measurement so the panel doesn't visibly grow when
  // it first opens; animate every height change after that.
  useEffect(
    function enableHeightAnimationAfterFirstMeasure() {
      if (panelHeight !== undefined) {
        setAnimateHeight(true);
      }
    },
    [panelHeight],
  );

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setView('list');
      setDirection(1);
      setDraftEmail('');
      setPanelHeight(undefined);
      setPanelWidth(undefined);
      setAnimateHeight(false);
    }
  }

  function navigate(nextView: NotificationSettingsView, nextDirection: number) {
    setDirection(nextDirection);
    setView(nextView);
  }

  function openEmailEdit() {
    setDraftEmail(notificationEmail);
    navigate('edit-email', 1);
  }

  function handleEmailNotificationsToggle() {
    if (isEmailNotificationsLoading || updateEmailNotifications.isPending) {
      return;
    }
    updateEmailNotifications.mutate(!emailNotifications, {
      onError: () => {
        Growl.addGrowlMessage({
          id: 'inbox-email-notifications-toggle-error',
          title: t('builder_status_error', undefined, 'Error'),
          children: t('builder_inbox_notifications_toggle_error', undefined, 'Could not update notification setting. Please try again.'),
          emphasis: 'critical',
          lifetime: 5000,
        });
      },
    });
  }

  const trimmedDraft = draftEmail.trim();
  // Only surface the format error once the user has typed something; an empty
  // field already disables Save without an error message.
  const isEmailFormatInvalid = trimmedDraft.length > 0 && !EMAIL_FORMAT_RE.test(trimmedDraft);
  const isSaveDisabled =
    trimmedDraft.length === 0 ||
    trimmedDraft === notificationEmail ||
    isEmailFormatInvalid ||
    updateStaffNotificationEmail.isPending ||
    isStaffLoading ||
    !staff;

  function handleSaveEmail() {
    if (isSaveDisabled || !staff) {
      return;
    }
    updateStaffNotificationEmail.mutate(
      { staffId: staff.id, notificationEmail: trimmedDraft },
      {
        onSuccess: () => {
          Growl.addGrowlMessage({
            id: 'inbox-notification-email-save-success',
            title: t('builder_status_success', undefined, 'Success'),
            children: t('builder_inbox_notifications_email_save_success', undefined, 'Notification email was successfully changed.'),
            emphasis: 'success',
            lifetime: 5000,
          });
          navigate('list', -1);
        },
        onError: () => {
          Growl.addGrowlMessage({
            id: 'inbox-notification-email-save-error',
            title: t('builder_status_error', undefined, 'Error'),
            children: t('builder_inbox_notifications_email_save_error', undefined, 'Could not update notification email. Please try again.'),
            emphasis: 'critical',
            lifetime: 5000,
          });
        },
      },
    );
  }

  function renderSettingsList() {
    return (
      <div className='py-1' data-testid='inbox-notification-settings-list'>
        <div className='flex items-center gap-3 px-4 py-3'>
          <ToggleButton
            id='inbox-email-notifications'
            data-testid='inbox-email-notifications-toggle'
            active={emailNotifications}
            disabled={isEmailNotificationsLoading || updateEmailNotifications.isPending}
            onClick={handleEmailNotificationsToggle}
          />
          <div className='min-w-0 flex-1'>
            <text.span as='action' size={0} className='block truncate'>
              {t('builder_inbox_notifications_label', undefined, 'Email Notifications')}
            </text.span>
            <text.p emphasis='passive' size={-1} className='m-0 truncate'>
              {isStaffLoading ? '…' : notificationEmail}
            </text.p>
          </div>
          <Button
            className='shrink-0'
            design='minimal'
            size='sm'
            icon={<ChevronRightIcon width={16} height={16} />}
            aria-label={t('builder_inbox_notifications_email_settings_aria', undefined, 'Email Notification settings')}
            disabled={isStaffLoading || !staff}
            onClick={openEmailEdit}
          />
        </div>
      </div>
    );
  }

  function renderNotificationEmailEdit() {
    return (
      <div
        className='flex flex-col pt-3 pb-3'
        data-testid='inbox-notification-edit-email-panel'
      >
        <div className='flex shrink-0 items-center gap-1 px-3 py-1.5'>
          <Button
            design='minimal'
            size='sm'
            icon={<ChevronLeftIcon width={16} height={16} />}
            aria-label={t('builder_inbox_notifications_back_aria', undefined, 'Back to notification settings')}
            onClick={() => navigate('list', -1)}
            data-testid='inbox-notification-edit-email-back'
          />
          <text.span as='action' size={0}>
            {t('builder_inbox_notifications_edit_email_title', undefined, 'Edit Notification Email')}
          </text.span>
        </div>
        <div className='mt-3 shrink-0 px-4'>
          <TextInput
            id='inbox-notification-email'
            data-testid='inbox-notification-email-input'
            label={null}
            className='w-full'
            value={draftEmail}
            onChange={setDraftEmail}
            visualSize='sm'
            type='email'
            invalid={isEmailFormatInvalid}
            errorMessage={
              isEmailFormatInvalid
                ? t('builder_inbox_notifications_email_invalid', undefined, 'Enter a valid email address.')
                : undefined
            }
          />
        </div>
        <div className='mt-4 flex shrink-0 justify-end gap-2 px-4'>
          <Button
            design='tertiary'
            size='sm'
            text={t('builder_common_cancel', undefined, 'Cancel')}
            onClick={() => navigate('list', -1)}
            data-testid='inbox-notification-edit-email-cancel'
          />
          <Button
            design='primary'
            size='sm'
            text={t('builder_common_save', undefined, 'Save')}
            disabled={isSaveDisabled}
            onClick={handleSaveEmail}
            data-testid='inbox-notification-edit-email-save'
          />
        </div>
      </div>
    );
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          design='tertiary'
          size='sm'
          icon={<BellIcon />}
          disabled={disabled}
          aria-label={t('builder_inbox_notifications_manage_aria', undefined, 'Manage notifications')}
          data-testid='inbox-manage-notifications'
        />
      </PopoverTrigger>
      <PopoverContent
        align='end'
        className='min-w-[320px] max-w-[420px] w-auto p-0'
        data-testid='inbox-notification-settings-menu'
      >
        <motion.div
          initial={false}
          animate={{ height: panelHeight, width: panelWidth }}
          transition={animateHeight ? slideTransition : { duration: 0 }}
          className='relative min-w-[320px] max-w-[420px] overflow-hidden'
          data-testid='inbox-notification-settings-panel'
        >
          <AnimatePresence initial={false} custom={direction}>
            <motion.div
              key={view}
              ref={measureActiveView}
              {...slideMotionProps(direction)}
              className='absolute left-0 top-0 w-max min-w-[320px] max-w-[420px]'
            >
              {view === 'list' && renderSettingsList()}
              {view === 'edit-email' && renderNotificationEmailEdit()}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </PopoverContent>
    </Popover>
  );
}
