/**
 * Conversation History Debug Script
 * 
 * Run this to debug conversation history issues with multiple agents.
 * Usage: pnpm tsx scripts/debug-conversation-history.ts <appId> [agentId]
 */

import { ConversationRepository } from '../src/database/repositories/ConversationRepository.js'
import { ConversationContextManager } from '../src/services/ConversationContextManager.js'
import { getDatabase } from '../src/database/connection.js'

const appId = process.argv[2]
const agentId = process.argv[3]

if (!appId) {
  console.error('Usage: pnpm tsx scripts/debug-conversation-history.ts <appId> [agentId]')
  process.exit(1)
}

console.log('🔍 Debugging Conversation History')
console.log('=' .repeat(80))
console.log(`App ID: ${appId}`)
if (agentId) {
  console.log(`Agent ID: ${agentId}`)
}
console.log('=' .repeat(80))

const conversationRepo = new ConversationRepository()
const contextManager = new ConversationContextManager(conversationRepo, 10)
const db = getDatabase()

// 1. Check if app exists
console.log('\n📦 Checking App...')
const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId) as any
if (!app) {
  console.error(`❌ App '${appId}' not found in database`)
  process.exit(1)
}
console.log(`✅ App found: ${app.name}`)

// 2. List all conversations for this app
console.log('\n💬 All Conversations for App:')
const allConversations = await conversationRepo.getByAppId(appId)
console.log(`Found ${allConversations.length} conversation(s)`)

for (const conv of allConversations) {
  const messages = await conversationRepo.getMessages(conv.id)
  console.log(`  - ID: ${conv.id}`)
  console.log(`    Agent: ${conv.agentId}`)
  console.log(`    Title: ${conv.title || '(no title)'}`)
  console.log(`    Created: ${conv.createdAt}`)
  console.log(`    Messages: ${messages.length}`)
  console.log(`    Updated: ${conv.updatedAt}`)
}

// 3. If specific agent provided, show agent-specific data
if (agentId) {
  console.log(`\n🤖 Agent-Specific Data for '${agentId}':`)
  
  const agentConversations = await conversationRepo.findByAppAndAgent(appId, agentId)
  console.log(`Found ${agentConversations.length} conversation(s) for agent '${agentId}'`)
  
  for (const conv of agentConversations) {
    console.log(`\n  Conversation: ${conv.id}`)
    const messages = await conversationRepo.getMessages(conv.id)
    console.log(`  Messages: ${messages.length}`)
    
    for (const msg of messages) {
      console.log(`    - [${msg.sender}] ${msg.content.substring(0, 80)}${msg.content.length > 80 ? '...' : ''}`)
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        console.log(`      Tools: ${msg.toolCalls.map(t => t.tool_name).join(', ')}`)
      }
    }
  }
  
  // 4. Test loadAllMessagesWithTokenLimit
  console.log(`\n📊 Testing loadAllMessagesWithTokenLimit for '${agentId}':`)
  const llmMessages = await contextManager.loadAllMessagesWithTokenLimit(appId, agentId, 40000)
  console.log(`Retrieved ${llmMessages.length} LLM message(s)`)
  
  const messagesByRole = llmMessages.reduce((acc, msg) => {
    acc[msg.role] = (acc[msg.role] || 0) + 1
    return acc
  }, {} as Record<string, number>)
  
  console.log('Message distribution:')
  for (const [role, count] of Object.entries(messagesByRole)) {
    console.log(`  - ${role}: ${count}`)
  }
  
  if (llmMessages.length === 0) {
    console.log('\n⚠️  WARNING: No messages retrieved for this agent!')
    console.log('Possible causes:')
    console.log('  1. Agent name mismatch (check exact spelling/case)')
    console.log('  2. Conversations created with different agent_id')
    console.log('  3. Messages not properly saved')
  }
} else {
  console.log('\n💡 TIP: Provide an agentId to see agent-specific details')
  console.log('Example: pnpm tsx scripts/debug-conversation-history.ts <appId> develop')
}

// 5. Show raw database data
console.log('\n🗄️  Raw Database Query:')
if (agentId) {
  const rawConversations = db.prepare(`
    SELECT id, agent_id, title, created_at, updated_at 
    FROM conversations 
    WHERE app_id = ? AND agent_id = ?
    ORDER BY updated_at DESC
  `).all(appId, agentId) as any[]
  
  console.log(`Found ${rawConversations.length} row(s) in conversations table:`)
  rawConversations.forEach(row => {
    console.log(`  - ID: ${row.id}, agent_id: '${row.agent_id}', title: ${row.title}`)
  })
} else {
  const rawConversations = db.prepare(`
    SELECT id, agent_id, title, created_at, updated_at 
    FROM conversations 
    WHERE app_id = ?
    ORDER BY agent_id, updated_at DESC
  `).all(appId) as any[]
  
  console.log(`Found ${rawConversations.length} row(s) in conversations table:`)
  const byAgent = rawConversations.reduce((acc, row) => {
    if (!acc[row.agent_id]) acc[row.agent_id] = []
    acc[row.agent_id].push(row)
    return acc
  }, {} as Record<string, any[]>)
  
  for (const [agent, rows] of Object.entries(byAgent)) {
    console.log(`\n  Agent: '${agent}' (${rows.length} conversation(s))`)
    rows.forEach(row => {
      console.log(`    - ID: ${row.id}, title: ${row.title}`)
    })
  }
}

console.log('\n' + '='.repeat(80))
console.log('✅ Debug complete')
