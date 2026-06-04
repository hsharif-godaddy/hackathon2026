/**
 * Database repositories barrel export
 */

import { ImportJobRepository } from './ImportJobRepository.js';
import { OAuthTokenRepository } from './OAuthTokenRepository.js';

import { AppRepository } from './AppRepository.js';
import { SocialAssociationRepository } from './SocialAssociationRepository.js';
import { SocialPostRepository } from './SocialPostRepository.js';
import { ShareTokenRepository } from './ShareTokenRepository.js';
import { RouteRepository } from './RouteRepository.js';
import { BlogPostRepository } from './BlogPostRepository.js';

// Create singleton instances
export const appRepository = new AppRepository();
export const routeRepository = new RouteRepository();
export const blogPostRepository = new BlogPostRepository();

export const oauthTokenRepository = new OAuthTokenRepository();
export const importJobRepository = new ImportJobRepository();
export const socialAssociationRepository = new SocialAssociationRepository();
export const socialPostRepository = new SocialPostRepository();
export const shareTokenRepository = new ShareTokenRepository();

// Also export the classes for direct instantiation if needed
export { AppRepository } from './AppRepository.js';
export { ConversationRepository } from './ConversationRepository.js';

export { TodoListRepository } from './TodoListRepository.js';
export { OAuthTokenRepository } from './OAuthTokenRepository.js';
export { ImportJobRepository } from './ImportJobRepository.js';
export { SocialAssociationRepository } from './SocialAssociationRepository.js';
export { SocialPostRepository } from './SocialPostRepository.js';
export { ShareTokenRepository } from './ShareTokenRepository.js';
export { RouteRepository } from './RouteRepository.js';
export { BlogPostRepository } from './BlogPostRepository.js';
