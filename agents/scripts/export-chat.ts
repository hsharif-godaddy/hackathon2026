/**
 * Conversation Export CLI
 *
 * Export all conversations for an app as markdown.
 * Usage: pnpm tsx scripts/export-chat.ts <appId> [--detail=summary|full]
 */
import { ConversationRepository } from '../src/database/repositories/ConversationRepository.js';
import { exportConversations } from '../src/services/conversation-exporter.js';
import type { ExportDetail } from '../src/services/conversation-exporter.js';

const appId = process.argv[2];
const detailArg = process.argv.find((arg) => arg.startsWith('--detail='));
const detail: ExportDetail = (detailArg?.split('=')[1] as ExportDetail) || 'summary';

if (!appId) {
  console.error('Usage: pnpm tsx scripts/export-chat.ts <appId> [--detail=summary|full]');
  process.exit(1);
}

if (detail !== 'summary' && detail !== 'full') {
  console.error('Error: --detail must be "summary" or "full"');
  process.exit(1);
}

const conversationRepo = new ConversationRepository();
const conversations = await conversationRepo.getByAppId(appId);

if (conversations.length === 0) {
  console.error(`No conversations found for app: ${appId}`);
  process.exit(0);
}

const allMessages = await conversationRepo.getMessagesBatch(conversations.map(c => c.id));
const messagesByConversation = new Map<string, typeof allMessages>();
for (const msg of allMessages) {
  const existing = messagesByConversation.get(msg.conversationId) || [];
  existing.push(msg);
  messagesByConversation.set(msg.conversationId, existing);
}

const markdown = exportConversations(appId, conversations, messagesByConversation, detail);
console.log(markdown);
