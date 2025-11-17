/**
 * Database repositories barrel export
 */

import { AppRepository } from './AppRepository.js';
import { ConversationRepository } from './ConversationRepository.js';
import { TokenUsageRepository } from './TokenUsageRepository.js';
import { TodoListRepository } from './TodoListRepository.js';
import { OAuthTokenRepository } from './OAuthTokenRepository.js';

// Create singleton instances
export const appRepository = new AppRepository();
export const conversationRepository = new ConversationRepository();
export const tokenUsageRepository = new TokenUsageRepository();
export const todoListRepository = new TodoListRepository();
export const oauthTokenRepository = new OAuthTokenRepository();

// Also export the classes for direct instantiation if needed
export { AppRepository } from './AppRepository.js';
export { ConversationRepository } from './ConversationRepository.js';
export { TokenUsageRepository } from './TokenUsageRepository.js';
export { TodoListRepository } from './TodoListRepository.js';
export { OAuthTokenRepository } from './OAuthTokenRepository.js';
