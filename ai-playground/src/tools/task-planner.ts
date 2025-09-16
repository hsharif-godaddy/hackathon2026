import { createTool } from '@airo/ai-lib'
import { z } from 'zod'

export const taskPlannerTool = createTool(
  'Break down complex tasks into actionable steps',
  z.object({
    task: z.string().describe('The task to break down'),
    timeframe: z.string().optional().describe('Timeframe for the task (e.g., "1 week", "today")')
  }),
  async ({ task, timeframe }: { task: string; timeframe?: string | undefined }) => {
    // Simulate task planning
    const steps = [
      `Research and gather requirements for: ${task}`,
      'Identify necessary resources and dependencies',
      'Create a detailed action plan',
      'Set milestones and checkpoints',
      'Execute each step systematically',
      'Review and optimize the process'
    ]
    
    return {
      task,
      timeframe: timeframe || 'Not specified',
      steps,
      estimatedDuration: timeframe ? `Within ${timeframe}` : '1-3 days',
      priority: 'Medium',
      success: true
    }
  }
)
