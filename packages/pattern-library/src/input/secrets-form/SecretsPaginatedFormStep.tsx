import type { ReactNode } from 'react';

/**
 * Virtual step child for {@link SecretsPaginatedForm}. Renders nothing on its
 * own — the parent reads props directly, same pattern as `ChoiceList.Step`.
 */
export interface SecretsPaginatedFormStepProps {
  /** Stable key used in the `onComplete` values record. */
  id: string;
  /** Step heading when {@link SecretsPaginatedFormProps.hideStepTitle} is false. */
  title?: ReactNode;
  /** Field label (e.g. `STRIPE_SECRET_KEY:`). Defaults to `` `${id}:` ``. */
  label?: string;
  /** Helper copy shown below the password field. */
  helperText?: string;
  /** Input placeholder. @default "Enter value" */
  placeholder?: string;
  /** When false, empty values can advance. @default true */
  required?: boolean;
}

export function SecretsPaginatedFormStep(_props: SecretsPaginatedFormStepProps): null {
  return null;
}

SecretsPaginatedFormStep.displayName = 'SecretsPaginatedFormStep';
