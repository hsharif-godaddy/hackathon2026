export interface Message {
  id: number
  sender: 'user' | 'agent'
  content: string
  timestamp: Date
  isThinking?: boolean
  handoff?: {
    to: string
    action: string
    url: string
  }
}

export interface PlanItem {
  id: string
  title: string
  description: string
  status: 'pending' | 'in_progress' | 'complete'
  tasks: string[]
  estimatedTime: string
}
