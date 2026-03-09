import { Controller, useForm } from "react-hook-form";
import Box from "@ux/box";
import Button from "@ux/button";
import Checkbox from "@ux/checkbox";
import Radio from "@ux/radio";
import text from "@ux/text";
import TextInput from "@ux/text-input";

import { useAuthContext } from "@/components/providers/AuthProvider";
import { useTranslations } from "@/hooks/useTranslations";
import { logger } from '@/lib/request-context';
import type { SlackLink } from '@/lib/slack-webhook';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSitesStore } from '@/stores/useSitesStore';
import type { FeedbackFormProps } from "./types";
import { getBaseUrl, getFullStorySessionUrl, isLocalhost } from "./utils";

export function FeedbackForm({
  config,
  onClose,
  onSubmitSuccess,
  onSubmitError,
  eids,
}: FeedbackFormProps) {
  const t = useTranslations();
  const { control, handleSubmit, formState } = useForm();
  const { getUserInfo } = useAuthContext();
  const currentAppId = useDevelopPageStore((state) => state.currentAppId);
  const getSite = useSitesStore((state) => state.getSite);

  async function sendToSlack(data: any) {
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
                  const totalCredits = creditsData.data.reduce((sum, grant) => sum + (grant.creditsMax || 0), 0);
                  const totalSpent = creditsData.data.reduce((sum, grant) => sum + (grant.creditsSpent || 0), 0);
                  const remaining = totalCredits - totalSpent;
                  subscriptionInfo = `${planName} - ${remaining}/${totalCredits}`;
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

      // Build right column with rating (big emoji + label)
      const rightFields: Array<{ label?: string; value: string }> = [];
      if (rating) {
        const ratingNumber = String(rating).charAt(0);
        const ratingEmojis: Record<string, string> = {
          '1': ':crying_cat:',
          '2': ':sob:',
          '3': ':unamused:',
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

      // Build single-column sections
      const singleColumnSections: Array<{ label?: string; value: string }> = [];

      // Subscription information (full-width section)
      if (subscriptionInfo) {
        singleColumnSections.push({
          label: 'Subscription',
          value: subscriptionInfo,
        });
      }

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
        links.push({ url: previewUrl, text: 'Preview site' });
      }
      if (isValidPublishedUrl) {
        links.push({ url: publishedUrl, text: 'Published site' });
      }

      // FullStory link
      if (fullStoryUrl) {
        links.push({ url: fullStoryUrl, text: 'FullStory session' });
      }

      // Console link (at the end)
      if (currentAppId) {
        links.push({ url: `https://console.airo-builder.godaddy.com/?appId=${currentAppId}`, text: 'Console' });
      }

      // Send Block Kit formatted message with two-column layout (no title)
      await fetch('/api/slack-webhook/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          blockMessage: {
            twoColumnSection: leftFields.length > 0 && rightFields.length > 0 ? {
              leftFields,
              rightFields,
            } : undefined,
            singleColumnSections: singleColumnSections.length > 0 ? singleColumnSections : undefined,
            links: links.length > 0 ? links : undefined,
          },
        }),
      });
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

  function onSubmit(data: any) {
    // Close immediately (optimistic UI)
    if (onSubmitSuccess) {
      const mockResponse = {
        success: true,
        message: 'Feedback submitted successfully'
      };
      onSubmitSuccess(mockResponse);
    } else {
      onClose();
    }

    // Fire and forget - submit in background
    if (isLocalhost()) {
      // Send to Slack in background
      sendToSlack(data).catch((err) => {
        logger.warn('feedback.slack.background_send_failed', {
          feedbackId: config.pk,
          error: err instanceof Error ? err.message : String(err)
        });
      });
      return;
    }

    // Production: submit to API in background
    const customerId = getUserInfo()?.customerId ?? '';
    if (!customerId) {
      logger.warn('feedback.submit.missing_customer_id', { feedbackId: config.pk });
    }
    const keys = [...Object.keys(data), 'customerId'];
    const values = [...Object.values(data), customerId];
    const baseUrl = getBaseUrl();
    fetch(baseUrl + "feedbacks/" + encodeURIComponent(config.pk), {
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
    })
      .then((res) => res.json())
      .then(async () => {
        // Send to Slack after successful database save
        await sendToSlack(data);
        logger.info('feedback.submit.success', {
          feedbackId: config.pk,
          customerId,
        });
      })
      .catch((err) => {
        if (onSubmitError) {
          onSubmitError(err);
        } else {
          logger.error('feedback.submit.failed', {
            feedbackId: config.pk,
            customerId,
            error: err instanceof Error ? err.message : String(err)
          });
        }
      });
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit, (err) => {
        logger.debug('feedback.form.validation.failed', { error: String(err) });
      })}
    >
      <Box gap="xl">
        {config.fields.map((field) => {
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
            text={t('builder_common_submit')}
            data-eid={eids?.submitButton}
          />
          <Button
            text={t('builder_common_cancel')}
            onClick={onClose}
            data-eid={eids?.cancelButton}
          />
        </Box>
      </Box>
    </form>
  );
}
