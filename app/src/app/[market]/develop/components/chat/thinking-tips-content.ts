import { tips } from '@/app/[market]/develop/components/tips/tips-content'

export const THINKING_TIPS = tips.map(function mapTip(tip) {
  return `builder_tips_${tip}_description`
})
