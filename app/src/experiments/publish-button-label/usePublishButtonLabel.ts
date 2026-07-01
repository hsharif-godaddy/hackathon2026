import { useSearchParams } from 'next/navigation'

import { EXPERIMENT_IDS } from '@/config/experiments'
import { useHivemind } from '@/hooks/useHivemind'

/** URL query param used to force a variant for QA/demo. */
const QA_OVERRIDE_KEY = 'publishButtonLabel'

/**
 * Cohort IDs for the publish-button-label Hivemind experiment.
 *
 * 3-way A/B/C test on the Publish button label to improve publish rate.
 * Never-published and already-published users see different label sets.
 */
export enum PublishButtonLabelCohort {
  /** Control — "Publish" (existing label, baseline). */
  CONTROL = 'control',
  /** Variant A — "Go Live" (never published) / "Apply Updates" (already published). */
  GO_LIVE = 'go-live',
  /** Variant B — "Launch" (never published) / "Apply Updates" (already published). */
  LAUNCH = 'launch',
}

const NEVER_PUBLISHED_LABELS: Readonly<Record<PublishButtonLabelCohort, string>> = {
  [PublishButtonLabelCohort.CONTROL]: 'builder_publish_button',
  [PublishButtonLabelCohort.GO_LIVE]: 'builder_publish_button_go_live',
  [PublishButtonLabelCohort.LAUNCH]: 'builder_publish_button_launch',
}

const ALREADY_PUBLISHED_LABELS: Readonly<Record<PublishButtonLabelCohort, string>> = {
  [PublishButtonLabelCohort.CONTROL]: 'builder_publish_button',
  [PublishButtonLabelCohort.GO_LIVE]: 'builder_publish_button_apply_update',
  [PublishButtonLabelCohort.LAUNCH]: 'builder_publish_button_apply_update',
}

/**
 * Returns the i18n key for the Publish button label based on the user's
 * Hivemind cohort and whether the app has been published before.
 *
 * QA override: add `?publishButtonLabel=go-live` to the develop URL.
 */
export function usePublishButtonLabel(isFirstPublish: boolean): string {
  const { cohort } = useHivemind(EXPERIMENT_IDS.publishButtonLabel)
  const searchParams = useSearchParams()
  const overrideCohort = searchParams.get(QA_OVERRIDE_KEY) || undefined;
  const effectiveCohort = overrideCohort ?? cohort ?? PublishButtonLabelCohort.CONTROL

  const labels = isFirstPublish ? NEVER_PUBLISHED_LABELS : ALREADY_PUBLISHED_LABELS

  return labels[effectiveCohort] ?? 'builder_publish_button'
}
