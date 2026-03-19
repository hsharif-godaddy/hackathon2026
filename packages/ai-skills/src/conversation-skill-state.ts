/**
 * ConversationSkillState - Per-conversation tracking of active skills
 *
 * Tracks which skills are active in each conversation and their last-used step
 * for automatic inactivity-based unloading.
 */

import { buildSkillToolName } from './constants.js'

export interface ActiveSkillState {
  skillName: string
  lastUsedStep: number
}

export class ConversationSkillState {
  // Map<conversationId, Map<skillName, ActiveSkillState>>
  private activeSkills = new Map<string, Map<string, ActiveSkillState>>()

  // Map<skillName, toolNames[]> - registered tool names per skill
  private skillTools = new Map<string, string[]>()

  /**
   * Activate a skill for a conversation
   * Idempotent - if already active, resets lastUsedStep
   */
  activate(conversationId: string, skillName: string, stepNumber: number): void {
    let convSkills = this.activeSkills.get(conversationId)
    if (!convSkills) {
      convSkills = new Map()
      this.activeSkills.set(conversationId, convSkills)
    }

    convSkills.set(skillName, {
      skillName,
      lastUsedStep: stepNumber
    })
  }

  /**
   * Deactivate a skill for a conversation
   */
  deactivate(conversationId: string, skillName: string): void {
    const convSkills = this.activeSkills.get(conversationId)
    if (convSkills) {
      convSkills.delete(skillName)
      if (convSkills.size === 0) {
        this.activeSkills.delete(conversationId)
      }
    }
  }

  /**
   * Update the lastUsedStep for a skill
   */
  updateLastUsed(conversationId: string, skillName: string, stepNumber: number): void {
    const convSkills = this.activeSkills.get(conversationId)
    const state = convSkills?.get(skillName)
    if (state) {
      state.lastUsedStep = stepNumber
    }
  }

  /**
   * Get active skills for a conversation
   */
  getActiveSkills(conversationId: string): Map<string, ActiveSkillState> {
    return this.activeSkills.get(conversationId) || new Map()
  }

  /**
   * Register tool names for a skill (called at startup during pre-registration)
   */
  setSkillTools(skillName: string, toolNames: string[]): void {
    this.skillTools.set(skillName, toolNames)
  }

  /**
   * Get prefixed tool names for all active skills in a conversation
   */
  getActiveToolNames(conversationId: string): string[] {
    const convSkills = this.activeSkills.get(conversationId)
    if (!convSkills) {return []}

    const toolNames: string[] = []
    for (const skillName of convSkills.keys()) {
      const tools = this.skillTools.get(skillName) || []
      for (const tool of tools) {
        toolNames.push(buildSkillToolName(skillName, tool))
      }
    }
    return toolNames
  }

  /**
   * Cleanup skills that have been inactive for more than the threshold
   * Returns array of deactivated skill names
   */
  cleanupInactiveSkills(
    conversationId: string,
    currentStep: number,
    inactivityThreshold: number
  ): string[] {
    const convSkills = this.activeSkills.get(conversationId)
    if (!convSkills) {return []}

    const deactivated: string[] = []
    for (const [skillName, state] of convSkills) {
      const stepsSinceUse = currentStep - state.lastUsedStep
      if (stepsSinceUse > inactivityThreshold) {
        convSkills.delete(skillName)
        deactivated.push(skillName)
      }
    }

    if (convSkills.size === 0) {
      this.activeSkills.delete(conversationId)
    }

    return deactivated
  }

  /**
   * Clear all state for a conversation (e.g., on server restart recovery)
   */
  clearConversation(conversationId: string): void {
    this.activeSkills.delete(conversationId)
  }
}
