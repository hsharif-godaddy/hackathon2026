import type { Persona } from './types.js';

export interface AiroBaselineBusinessContext {
  industry: string;
  businessName: string;
  businessDescription: string;
  targetAudience: string;
  brandPersonality: string[];
  colorPreferences: string[];
  stylePreferences: string[];
}

export interface AiroBaselineCommunicationStyle {
  formality: string;
  detailLevel: string;
  technicalLevel: string;
  examples: string[];
}

export interface AiroBaselinePersonaProfile {
  traits: string[];
  decisionMaking: string;
  riskTolerance: string;
  rejectionTriggers: string[];
  acceptanceTriggers: string[];
  exitTriggers: string[];
  retryTriggers: string[];
  communicationStyle: AiroBaselineCommunicationStyle;
}

export interface AiroBaselineGoal {
  name: string;
  goals: string[];
}

export interface AiroBaselineSyntheticUser {
  syntheticId: string;
  name: string;
  type?: string;
  persona: {
    name: string;
    coreTraits: string[];
    decisionPattern: string;
    communicationStyle: AiroBaselineCommunicationStyle;
    rejectionTriggers: string[];
    acceptanceTriggers: string[];
    exitTriggers?: string[];
    retryTriggers?: string[];
  };
}

function formatList(items: string[]): string {
  if (items.length === 0) return '(none)';
  return items.map((item) => `- ${item}`).join('\n');
}

export function buildAiroBaselinePersona(
  user: AiroBaselineSyntheticUser,
  context: {
    business: AiroBaselineBusinessContext;
    customerSummary: string;
    testingCapability: string;
  },
): Persona {
  const business = context.business;
  const profile = user.persona;
  const style = profile.communicationStyle;

  return {
    name: `airo-baseline/${user.syntheticId}`,
    description: context.customerSummary,
    systemPrompt: [
      'You are a realistic Airo App Builder synthetic user.',
      'Stay in character as the business owner described below.',
      'Use simple, natural language. Do not mention that you are synthetic.',
      'If the agent asks a relevant clarifying question, answer using the ground truth below.',
      'If the agent misses something important, push back using your rejection triggers.',
      '',
      `Synthetic ID: ${user.syntheticId}`,
      `Business: ${business.businessName}`,
      `Industry: ${business.industry}`,
      `Description: ${business.businessDescription}`,
      `Target audience: ${business.targetAudience}`,
      '',
      `Brand personality:\n${formatList(business.brandPersonality)}`,
      '',
      `Color preferences:\n${formatList(business.colorPreferences)}`,
      '',
      `Style preferences:\n${formatList(business.stylePreferences)}`,
      '',
      `Traits:\n${formatList(profile.coreTraits)}`,
      '',
      `Decision making: ${profile.decisionPattern}`,
      '',
      `Reject or push back when:\n${formatList(profile.rejectionTriggers)}`,
      '',
      `Accept when:\n${formatList(profile.acceptanceTriggers)}`,
      '',
      `Exit triggers:\n${formatList(profile.exitTriggers ?? [])}`,
      '',
      `Retry triggers:\n${formatList(profile.retryTriggers ?? [])}`,
      '',
      `Testing capability:\n${context.testingCapability}`,
      '',
      'Communication style:',
      `- formality: ${style.formality}`,
      `- detail level: ${style.detailLevel}`,
      `- technical level: ${style.technicalLevel}`,
      '',
      `Example phrases:\n${formatList(style.examples)}`,
    ].join('\n'),
  };
}
