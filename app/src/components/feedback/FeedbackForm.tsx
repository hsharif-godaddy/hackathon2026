import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { isEmployeeAuthType } from '@airo/shared/auth';
import Box from "@ux/box";
import Button from "@ux/button";
import Checkbox from "@ux/checkbox";
import Radio from "@ux/radio";
import Spinner from "@ux/spinner";
import text from "@ux/text";
import TextInput from "@ux/text-input";

import { useAuthContext } from "@/components/providers/AuthProvider";
import { useTranslations } from "@/hooks/useTranslations";
import { logger } from '@/lib/request-context';
import { formatSlackBlockMessage, type SlackBlockMessage, type SlackLink } from '@/lib/slack-webhook';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSitesStore } from '@/stores/useSitesStore';
import { getEffectiveCreditsSpent } from '@/utils/credits';
import { isLocalDev } from '@/utils/is-local-dev';
import type { FeedbackFormProps } from "./types";
import { getBaseUrl, getFullStorySessionUrl } from "./utils";

export function FeedbackForm({
  config,
  onClose,
  onSubmitSuccess,
  onSubmitError,
  eids,
  origin,
}: FeedbackFormProps) {
  const t = useTranslations();
  const { control, handleSubmit, formState } = useForm();
  const { getUserInfo, authState } = useAuthContext();
  const currentAppId = useDevelopPageStore((state) => state.currentAppId);
  const getSite = useSitesStore((state) => state.getSite);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // TLA detection for internal users
  const userInfo = getUserInfo();
  const shopperId = userInfo?.shopperId as string | undefined;
  const isInternalUser = shopperId?.length === 3;

  // Impersonation detection (e2s/e2s2s)
  const isImpersonating = isEmployeeAuthType(authState?.authType);

  async function sendToSlack(data) {
    try {
      // Get site info for URLs
      const site = currentAppId ? getSite(currentAppId) : null;
      const previewUrl = site?.preview_url;
      const publishedUrl = site?.published_url;
      // Filter out test URLs (they don't work)
      const isValidPublishedUrl = publishedUrl && !publishedUrl.includes('test-');

      // Get FullStory session URL
      const fullStoryUrl = await getFullStorySessionUrl(true);

      // Fetch subscription and credit grant info
      let subscriptionInfo = '';
      try {
        const subscriptionResponse = await fetch('/api/subscriptions', {
          credentials: 'include',
        });
        if (subscriptionResponse.ok) {
          const subscriptionData = await subscriptionResponse.json();
          const activeSubscription = subscriptionData.data?.active;

          if (activeSubscription) {
            const plan = activeSubscription.plan || 'Unknown';
            // Capitalize first letter of plan name
            const planName = plan.charAt(0).toUpperCase() + plan.slice(1);

            // Get credit grants
            if (activeSubscription.id) {
              const creditsResponse = await fetch(`/api/credits/grants?subscriptionId=${activeSubscription.id}&syncSpend=false`, {
                credentials: 'include',
              });
              if (creditsResponse.ok) {
                const creditsData = await creditsResponse.json();
                if (creditsData.success && Array.isArray(creditsData.data)) {
                  const totalCreditsMax = creditsData.data.reduce((sum, grant) => sum + (grant.creditsMax || 0), 0);
                  const totalCreditsSpent = creditsData.data.reduce(
                    (sum, grant) => sum + getEffectiveCreditsSpent(grant.creditsSpent, grant.creditsMax),
                    0
                  );
                  subscriptionInfo = `${planName} - ${totalCreditsSpent}/${totalCreditsMax}`;
                }
              }
            }
          }
        }
      } catch (err) {
        logger.warn('feedback.slack.subscription_fetch_failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Extract rating and comment from feedback data
      const rating = data['rate-overal-experience'];
      const comment = data['improvemets-free-text']; // expected typo
      const customerConsent = data['customer-consent'];

      // Build left column fields
      const leftFields: Array<{ label: string; value: string }> = [];

      // App ID
      if (currentAppId) {
        leftFields.push({
          label: 'App ID',
          value: currentAppId,
        });
      }

      // Customer consent
      if (customerConsent !== undefined) {
        leftFields.push({
          label: 'Customer Consent',
          value: customerConsent ? 'Yes' : 'No',
        });
      }

      // Subscription information
      if (subscriptionInfo) {
        leftFields.push({
          label: 'Subscription',
          value: subscriptionInfo,
        });
      }

      // Build right column with rating (big emoji + label) and origin
      const rightFields: Array<{ label?: string; value: string }> = [];

      // Add rating display (or "No score" for internal/impersonating users)
      if (isImpersonating || isInternalUser) {
        rightFields.push({
          label: 'No score',
          value: isImpersonating ? 'E2S session' : 'TLA account',
        });
      } else if (rating) {
        // Regular user - show full rating
        const ratingNumber = String(rating).charAt(0);
        const ratingEmojis: Record<string, string> = {
          '1': ':alert_red: :alert_red: :alert_red:',
          '2': ':alert_orange: :alert_orange:',
          '3': ':alert_yellow:',
          '4': ':neutral_face:',
          '5': ':slightly_smiling_face:',
          '6': ':smile:',
          '7': ':star-struck:',
        };
        const ratingLabels: Record<string, string> = {
          '1': 'Very negative',
          '2': 'Negative',
          '3': 'Somewhat negative',
          '4': 'Neutral',
          '5': 'Positive',
          '6': 'Very positive',
          '7': 'Extremely positive',
        };
        const emoji = ratingEmojis[ratingNumber] || ':question:';
        const label = ratingLabels[ratingNumber] || 'Unknown';
        const ratingDisplay = `${ratingNumber}/7 - ${label}\n${emoji}`;

        rightFields.push({
          value: ratingDisplay,
        });
      }

      // Origin
      if (origin) {
        rightFields.push({
          label: 'Origin',
          value: origin,
        });
      }

      // Build single-column sections
      const singleColumnSections: Array<{ label?: string; value: string }> = [];

      // Comment section
      if (comment && String(comment).trim()) {
        singleColumnSections.push({
          label: 'Comment',
          value: String(comment).trim(),
        });
      }

      // Build URL links
      const links: SlackLink[] = [];

      // Preview and published URLs
      if (previewUrl) {
        links.push({ url: previewUrl, text: 'Preview' });
      }
      if (isValidPublishedUrl) {
        links.push({ url: publishedUrl, text: 'Published' });
      }

      // FullStory link
      if (fullStoryUrl) {
        links.push({ url: fullStoryUrl, text: 'FullStory' });
      }

      // Nexus and Console links
      if (currentAppId) {
        links.push({ url: `https://ctk.int.gdcorp.tools/nexus/results?criteria=app_id&term=${currentAppId}`, text: 'Nexus' });
        links.push({ url: `https://console.airo-builder.godaddy.com/?appId=${currentAppId}`, text: 'Console' });
      }

      const blockMessage: SlackBlockMessage = {
        twoColumnSection: leftFields.length > 0 && rightFields.length > 0 ? {
          leftFields,
          rightFields,
        } : undefined,
        singleColumnSections: singleColumnSections.length > 0 ? singleColumnSections : undefined,
        links: links.length > 0 ? links : undefined,
      };

      // Send Block Kit formatted message with two-column layout (no title)
      // Backend handles logging and Slack sending
      const response = await fetch('/api/slack-webhook/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          blockMessage,
          appId: currentAppId, // Pass appId for agent JWT token generation
        }),
      });

      // In dev mode, log the blockMessage returned from backend
      if (isLocalDev() && response.ok) {
        const result = await response.json();
        if (result.blockMessage) {
          const formattedPayload = formatSlackBlockMessage(result.blockMessage);
          console.log('📧 [DEV MODE] Feedback Slack payload:', JSON.stringify(formattedPayload, null, 2));
          logger.info('feedback.slack.dev_mode_logged', {
            feedbackId: config.pk,
            appId: currentAppId,
          });
        }
      }

      logger.info('feedback.slack.sent', {
        feedbackId: config.pk,
        appId: currentAppId,
        previewUrl,
        publishedUrl,
        fullStoryUrl,
      });
    } catch (err) {
      logger.warn('feedback.slack.send_failed', {
        feedbackId: config.pk,
        appId: currentAppId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async function onSubmit(data: any) {
    setIsSubmitting(true);

    try {
      if (isLocalDev()) {
        // Development: just send to Slack
        await sendToSlack(data);
        logger.info('feedback.submit.success', {
          feedbackId: config.pk,
        });
      } else {
        // Production: submit to API then send to Slack
        const customerId = getUserInfo()?.customerId ?? '';
        if (!customerId) {
          logger.warn('feedback.submit.missing_customer_id', { feedbackId: config.pk });
        }
        const keys = [...Object.keys(data), 'customerId'];
        const values = [...Object.values(data), customerId];
        const baseUrl = getBaseUrl();

        // Save to database
        const response = await fetch(baseUrl + "feedbacks/" + encodeURIComponent(config.pk), {
          mode: "cors",
          method: "POST",
          credentials: "include",
          headers: {
            "X-XSRF-TOKEN": "1",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            url: window?.location?.href,
            keys,
            values,
          }),
        });

        if (!response.ok) {
          throw new Error(`Failed to save feedback: ${response.status}`);
        }

        await response.json();

        // Send to Slack after successful database save
        await sendToSlack(data);

        logger.info('feedback.submit.success', {
          feedbackId: config.pk,
          customerId,
        });
      }

      // Success! Close the modal
      if (onSubmitSuccess) {
        const mockResponse = {
          success: true,
          message: 'Feedback submitted successfully'
        };
        onSubmitSuccess(mockResponse);
      } else {
        onClose();
      }
    } catch (err) {
      logger.error('feedback.submit.failed', {
        feedbackId: config.pk,
        error: err instanceof Error ? err.message : String(err)
      });

      if (onSubmitError) {
        onSubmitError(err);
      }

      // Don't close the modal on error - let the user retry
    } finally {
      setIsSubmitting(false);
    }
  }

  // Filter fields based on user type
  const visibleFields = config.fields.filter(field => {
    // Hide rating field for internal users (TLAs) and impersonation sessions
    if ((isInternalUser || isImpersonating) && field.id === 'rate-overal-experience') {
      return false;
    }
    return true;
  });

  return (
    <form
      onSubmit={handleSubmit(onSubmit, (err) => {
        logger.debug('feedback.form.validation.failed', { error: String(err) });
      })}
    >
      <Box gap="xl">
        {visibleFields.map((field) => {
          const { id, type, label, options, required, hint } = field;
          return (
            <div key={id}>
              {type === "radio" && options ? (
                <div>
                  <Box gap="md">
                    <text.label as="label" text={t(`builder_feedback_${id}_label`)} />
                    {options.map((v, index) => (
                      <Controller
                        key={v}
                        control={control}
                        name={id}
                        rules={{ required }}
                        render={({ field }) => {
                          return (
                            <Radio
                              id={v}
                              label={t(`builder_feedback_${id}_options_${index}`)}
                              {...field}
                              onChange={() => field.onChange(v)}
                              checked={field.value === v}
                            />
                          );
                        }}
                      />
                    ))}
                  </Box>
                  {hint && <text.div as="caption" text={hint} />}
                  {formState.errors?.[id]?.type === "required" && (
                    <text.div
                      as="caption"
                      emphasis="critical"
                      text={t('builder_feedback_select_option')}
                    />
                  )}
                </div>
              ) : type === "mtext" ? (
                <div>
                  <Controller
                    control={control}
                    name={id}
                    rules={{ required }}
                    render={({ field, fieldState }) => (
                      <Box gap="md">
                        <text.label as="label" text={t(`builder_feedback_${id}_label`)} />
                        <TextInput
                          id={id}
                          label={null}
                          {...field}
                          errorMessage={fieldState.error?.message}
                          required={required}
                          multiline
                          size={3}
                        />
                      </Box>
                    )}
                  />
                  {hint && <text.div as="caption" text={hint} />}
                </div>
              ) : type === "boolean" ? (
                <Controller
                  name={id}
                  control={control}
                  render={({ field }) => (
                    <Box gap="md">
                      <Checkbox id={id} label={label} {...field} />
                      {hint && <text.div as="caption" text={hint} />}
                    </Box>
                  )}
                />
              ) : null}
            </div>
          );
        })}
        <Box
          orientation="horizontal"
          gap="md"
          blockAlignChildren="end"
        >
          <Button
            type="submit"
            design="primary"
            text={isSubmitting ? t('builder_widgets_feedback_submitting') : t('builder_common_submit')}
            data-eid={eids?.submitButton}
            disabled={isSubmitting}
            icon={isSubmitting ? <Spinner size="sm" /> : undefined}
          />
          <Button
            text={t('builder_common_cancel')}
            onClick={onClose}
            data-eid={eids?.cancelButton}
            disabled={isSubmitting}
          />
        </Box>
      </Box>
    </form>
  );
}
