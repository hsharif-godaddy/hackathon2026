import type { ProblemType } from './types'

interface FixOption {
  label: string
  prompt: string
}

interface FixStrategy {
  optionA: FixOption
  optionB: FixOption
}

export const FIX_STRATEGIES: Record<ProblemType, FixStrategy> = {
  cta_buried: {
    optionA: {
      label: 'CTA in hero',
      prompt: 'Move the primary CTA button into the hero section above the fold',
    },
    optionB: {
      label: 'Sticky button',
      prompt: 'Add a sticky floating CTA button fixed to the bottom of the screen',
    },
  },
  contact_hidden: {
    optionA: {
      label: 'Simplify form',
      prompt: 'Reduce the contact form to 2 fields: name and message',
    },
    optionB: {
      label: 'Move form higher',
      prompt: 'Move the contact form to the top of the contact page',
    },
  },
  no_social_proof: {
    optionA: {
      label: 'Testimonials section',
      prompt: 'Add a testimonials section with 3 placeholder reviews',
    },
    optionB: {
      label: 'Star rating badge',
      prompt: 'Add a star rating badge near the primary CTA button',
    },
  },
}
