/**
 * Database repositories barrel export
 */

import { ImportJobRepository } from './ImportJobRepository.js';
import { OAuthTokenRepository } from './OAuthTokenRepository.js';
import { ConversationRepository } from './ConversationRepository.js';
import { TokenUsageRepository } from './TokenUsageRepository.js';
import { TodoListRepository } from './TodoListRepository.js';
import { AppRepository } from './AppRepository.js';
import { SocialAssociationRepository } from './SocialAssociationRepository.js';
import { SocialPostRepository } from './SocialPostRepository.js';
import { ShareTokenRepository } from './ShareTokenRepository.js';

// Create singleton instances
export const appRepository = new AppRepository();
export const conversationRepository = new ConversationRepository();
export const tokenUsageRepository = new TokenUsageRepository();
export const todoListRepository = new TodoListRepository();
export const oauthTokenRepository = new OAuthTokenRepository();
export const importJobRepository = new ImportJobRepository();
export const socialAssociationRepository = new SocialAssociationRepository();
export const socialPostRepository = new SocialPostRepository();
export const shareTokenRepository = new ShareTokenRepository();

// Also export the classes for direct instantiation if needed
export { AppRepository } from './AppRepository.js';
export { ConversationRepository } from './ConversationRepository.js';
export { TokenUsageRepository } from './TokenUsageRepository.js';
export { TodoListRepository } from './TodoListRepository.js';
export { OAuthTokenRepository } from './OAuthTokenRepository.js';
export { ImportJobRepository } from './ImportJobRepository.js';
export { SocialAssociationRepository } from './SocialAssociationRepository.js';
export { SocialPostRepository } from './SocialPostRepository.js';
export { ShareTokenRepository } from './ShareTokenRepository.js';
