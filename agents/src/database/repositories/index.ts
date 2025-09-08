/**
 * Database repositories barrel export
 */

import { AppRepository } from './AppRepository.js';
import { ConversationRepository } from './ConversationRepository.js';
import { TokenUsageRepository } from './TokenUsageRepository.js';

// Create singleton instances
export const appRepository = new AppRepository();
export const conversationRepository = new ConversationRepository();
export const tokenUsageRepository = new TokenUsageRepository();

// Also export the classes for direct instantiation if needed
export { AppRepository } from './AppRepository.js';
export { ConversationRepository } from './ConversationRepository.js';
export { TokenUsageRepository } from './TokenUsageRepository.js';
