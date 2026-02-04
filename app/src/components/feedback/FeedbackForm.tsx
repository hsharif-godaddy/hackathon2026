import { Controller, useForm } from "react-hook-form";
import Box from "@ux/box";
import Button from "@ux/button";
import Checkbox from "@ux/checkbox";
import Radio from "@ux/radio";
import text from "@ux/text";
import TextInput from "@ux/text-input";

import { useTranslations } from "@/hooks/useTranslations";
import { logger } from '@/lib/request-context';
import { useDevelopPageStore } from '@/stores/useDevelopPageStore';
import { useSitesStore } from '@/stores/useSitesStore';
import type { FeedbackFormProps } from "./types";
import { formatSlackFeedbackMessage, getBaseUrl, isLocalhost } from "./utils";

export function FeedbackForm({
  config,
  onClose,
  onSubmitSuccess,
  onSubmitError,
  eids,
}: FeedbackFormProps) {
  const t = useTranslations();
  const { control, handleSubmit, formState } = useForm();
  const currentAppId = useDevelopPageStore((state) => state.currentAppId);
  const getSite = useSitesStore((state) => state.getSite);

  async function sendToSlack(data: any) {
    try {
      // Get site info for URLs
      const site = currentAppId ? getSite(currentAppId) : null;
      const previewUrl = site?.preview_url;
      const publishedUrl = site?.published_url;
      const isPublished = !!publishedUrl;

      const title = `New Feedback Submitted${currentAppId ? ` for App ID: ${currentAppId}` : ''}`;
      const message = formatSlackFeedbackMessage(data);

      // Build URL information
      const urlLines: string[] = [];
      if (previewUrl) {
        urlLines.push(`*Preview URL*: ${previewUrl}`);
      }
      if (isPublished && publishedUrl) {
        urlLines.push(`*Published URL*: ${publishedUrl}`);
      }

      // Combine form data with URL info
      const fullMessage = [message, '', ...urlLines].join('\n');

      await fetch('/api/slack-webhook/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          message: fullMessage,
        }),
      });
      logger.info('feedback.slack.sent', {
        feedbackId: config.pk,
        appId: currentAppId,
        previewUrl,
        publishedUrl,
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
        keys: Object.keys(data),
        values: Object.values(data),
      }),
    })
      .then((res) => res.json())
      .then(async (res) => {
        // Send to Slack after successful database save
        await sendToSlack(data);
        logger.info('feedback.submit.success', {
          feedbackId: config.pk,
        });
      })
      .catch((err) => {
        if (onSubmitError) {
          onSubmitError(err);
        } else {
          logger.error('feedback.submit.failed', {
            feedbackId: config.pk,
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
