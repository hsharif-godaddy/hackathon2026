export type ProblemType = 'cta_buried' | 'contact_hidden' | 'no_social_proof'

export interface PulseInsight {
  problemType: ProblemType
  headline: string
  description: string
  suggestedFix: string
  confidence: number
  screenshotBase64: string
  filesRead: string[]
}

export interface PulseContextAttachment {
  type: 'pulse_insight'
  insight: PulseInsight
}

export interface PulseAnalyzeRequest {
  appId: string
  publishedUrl: string
}

export type PulseAnalyzeResponse =
  | { status: 'insight'; insight: PulseInsight }
  | { status: 'healthy'; message: string }
  | { status: 'error'; message: string }
