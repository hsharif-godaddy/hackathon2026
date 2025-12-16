import { Controller, useForm } from "react-hook-form";
import Box from "@ux/box";
import Button from "@ux/button";
import Checkbox from "@ux/checkbox";
import Radio from "@ux/radio";
import text from "@ux/text";
import TextInput from "@ux/text-input";

import { logger } from '@/lib/request-context';
import type { FeedbackFormProps } from "./types";
import { getBaseUrl, isLocalhost } from "./utils";

export function FeedbackForm({
  config,
  onClose,
  onSubmitSuccess,
  onSubmitError,
  eids,
}: FeedbackFormProps) {
  const { control, handleSubmit, formState } = useForm();

  async function onSubmit(data: any) {
    if (isLocalhost()) {
      await new Promise(resolve => setTimeout(resolve, 500));

      const mockResponse = {
        success: true,
        message: 'Feedback submitted successfully (mock)'
      };

      if (onSubmitSuccess) {
        onSubmitSuccess(mockResponse);
      } else {
        onClose();
      }
      return;
    }

    // Production: submit to API
    const baseUrl = getBaseUrl();
    await fetch(baseUrl + "feedbacks/" + encodeURIComponent(config.pk), {
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
      .then((res) => {
        if (onSubmitSuccess) {
          onSubmitSuccess(res);
        } else {
          onClose();
        }
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
                    <text.label as="label" text={label} />
                    {options.map((v) => (
                      <Controller
                        key={v}
                        control={control}
                        name={id}
                        rules={{ required }}
                        render={({ field }) => {
                          return (
                            <Radio
                              id={v}
                              label={v}
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
                      text="Please select an option"
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
                        <text.label as="label" text={label} />
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
            text={"Submit"}
            disabled={formState.isSubmitting}
            data-eid={eids?.submitButton}
          />
          <Button
            text={"Cancel"}
            onClick={onClose}
            data-eid={eids?.cancelButton}
          />
        </Box>
      </Box>
    </form>
  );
}
