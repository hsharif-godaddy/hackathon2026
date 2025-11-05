import { describe, it, expect, beforeEach } from 'vitest';
import { DuplicateTodoCreateStrategy } from '../compression/strategies/DuplicateTodoCreateStrategy.js';
import { TodoCreateResultSummarizer } from '../compression/strategies/TodoCreateResultSummarizer.js';
import { TodoMarkDoneAggregator } from '../compression/strategies/TodoMarkDoneAggregator.js';
import { MessageCompressor } from '../compression/MessageCompressor.js';
import type { LLMMessage } from '../ConversationHistoryLoader.js';

describe('Todo Compression Strategies', () => {
  describe('DuplicateTodoCreateStrategy', () => {
    let strategy: DuplicateTodoCreateStrategy;
    let compressor: MessageCompressor;

    beforeEach(() => {
      strategy = new DuplicateTodoCreateStrategy();
      compressor = new MessageCompressor();
      compressor.registerStrategy(strategy);
    });

    it('should keep single todo create unchanged', () => {
      const messages: LLMMessage[] = [
        {
          role: 'assistant',
          content: 'Creating todo',
          tool_calls: [{
            id: 'tool1',
            type: 'function',
            function: { 
              name: 'todoList', 
              arguments: JSON.stringify({ 
                operation: 'create_list',
                listName: 'My Tasks',
                items: [{ title: 'Task 1' }]
              })
            }
          }]
        },
        {
          role: 'tool',
          content: '✅ Created todo list: My Tasks with 1 items',
          tool_call_id: 'tool1',
          name: 'todoList'
        },
      ];

      const result = compressor.compressMessages(messages);

      expect(result.messages).toHaveLength(2);
      expect(result.stats.compressedMessages).toBe(0);
    });

    it('should compress duplicate todo creates', () => {
      const messages: LLMMessage[] = [
        // First create
        {
          role: 'assistant',
          content: 'Creating todo',
          tool_calls: [{
            id: 'tool1',
            type: 'function',
            function: { 
              name: 'todoList', 
              arguments: JSON.stringify({ 
                operation: 'create_list',
                listName: 'My Tasks',
                items: [{ title: 'Task 1' }]
              })
            }
          }]
        },
        {
          role: 'tool',
          content: '✅ Created list v1',
          tool_call_id: 'tool1',
          name: 'todoList'
        },
        // Second create (update)
        {
          role: 'assistant',
          content: 'Updating todo',
          tool_calls: [{
            id: 'tool2',
            type: 'function',
            function: { 
              name: 'todoList', 
              arguments: JSON.stringify({ 
                operation: 'create_list',
                listName: 'My Tasks',
                items: [{ title: 'Task 1' }, { title: 'Task 2' }]
              })
            }
          }]
        },
        {
          role: 'tool',
          content: '✅ Created list v2',
          tool_call_id: 'tool2',
          name: 'todoList'
        },
      ];

      const result = compressor.compressMessages(messages);

      expect(result.messages[1].content).toContain('[Duplicate todo list create removed');
      expect(result.messages[3].content).toBe('✅ Created list v2');
      expect(result.stats.compressedMessages).toBe(1);
    });
  });

  describe('TodoCreateResultSummarizer', () => {
    let strategy: TodoCreateResultSummarizer;
    let compressor: MessageCompressor;

    beforeEach(() => {
      strategy = new TodoCreateResultSummarizer();
      compressor = new MessageCompressor();
      compressor.registerStrategy(strategy);
    });

    it('should compress create_list results', () => {
      const verboseResult = `✅ **Todo List CREATE LIST**

Created todo list: My Tasks with 3 items

📋 **List: My Tasks**
*Do all the things*

**Items:**

**Pending (3):**
1. ⬜ Task One
   *First task description*
   \`ID: 123\`
2. ⬜ Task Two  
   *Second task description*
   \`ID: 456\`
3. ⬜ Task Three
   *Third task description*
   \`ID: 789\``;

      const messages: LLMMessage[] = [
        {
          role: 'assistant',
          content: 'Creating todo',
          tool_calls: [{
            id: 'tool1',
            type: 'function',
            function: { 
              name: 'todoList', 
              arguments: JSON.stringify({ 
                operation: 'create_list',
                listName: 'My Tasks',
                items: [
                  { title: 'Task One', description: 'First' },
                  { title: 'Task Two', description: 'Second' },
                  { title: 'Task Three', description: 'Third' }
                ]
              })
            }
          }]
        },
        {
          role: 'tool',
          content: verboseResult,
          tool_call_id: 'tool1',
          name: 'todoList'
        },
      ];

      const result = compressor.compressMessages(messages);

      expect(result.messages[1].content).toContain('Created todo list: "My Tasks" with 3 items');
      expect(result.messages[1].content).toContain('[Full list details available in tool call arguments]');
      expect(result.messages[1].content.length).toBeLessThan(verboseResult.length / 2);
      expect(result.stats.compressedMessages).toBe(1);
    });

    it('should not compress mark_done results', () => {
      const messages: LLMMessage[] = [
        {
          role: 'assistant',
          content: 'Marking done',
          tool_calls: [{
            id: 'tool1',
            type: 'function',
            function: { 
              name: 'todoList', 
              arguments: JSON.stringify({ 
                operation: 'mark_done',
                itemId: '123'
              })
            }
          }]
        },
        {
          role: 'tool',
          content: '✅ MARK DONE - Marked item as done',
          tool_call_id: 'tool1',
          name: 'todoList'
        },
      ];

      const result = compressor.compressMessages(messages);

      expect(result.stats.compressedMessages).toBe(0);
    });
  });

  describe('TodoMarkDoneAggregator', () => {
    let strategy: TodoMarkDoneAggregator;
    let compressor: MessageCompressor;

    beforeEach(() => {
      strategy = new TodoMarkDoneAggregator();
      compressor = new MessageCompressor();
      compressor.registerStrategy(strategy);
    });

    it('should keep single mark_done unchanged', () => {
      const messages: LLMMessage[] = [
        {
          role: 'assistant',
          content: 'Marking done',
          tool_calls: [{
            id: 'tool1',
            type: 'function',
            function: { 
              name: 'todoList', 
              arguments: JSON.stringify({ operation: 'mark_done', itemId: '123' })
            }
          }]
        },
        {
          role: 'tool',
          content: '✅ MARK DONE\n\n1. ✅ Task One\n   *Description*',
          tool_call_id: 'tool1',
          name: 'todoList'
        },
      ];

      const result = compressor.compressMessages(messages);

      expect(result.stats.compressedMessages).toBe(0);
    });

    it('should aggregate multiple mark_done operations', () => {
      const messages: LLMMessage[] = [
        // Mark done 1
        {
          role: 'assistant',
          content: 'Mark 1',
          tool_calls: [{
            id: 'tool1',
            type: 'function',
            function: { name: 'todoList', arguments: JSON.stringify({ operation: 'mark_done' }) }
          }]
        },
        {
          role: 'tool',
          content: '✅ MARK DONE\n\n1. ✅ Task One',
          tool_call_id: 'tool1',
          name: 'todoList'
        },
        // Mark done 2
        {
          role: 'assistant',
          content: 'Mark 2',
          tool_calls: [{
            id: 'tool2',
            type: 'function',
            function: { name: 'todoList', arguments: JSON.stringify({ operation: 'mark_done' }) }
          }]
        },
        {
          role: 'tool',
          content: '✅ MARK DONE\n\n1. ✅ Task Two',
          tool_call_id: 'tool2',
          name: 'todoList'
        },
        // Mark done 3
        {
          role: 'assistant',
          content: 'Mark 3',
          tool_calls: [{
            id: 'tool3',
            type: 'function',
            function: { name: 'todoList', arguments: JSON.stringify({ operation: 'mark_done' }) }
          }]
        },
        {
          role: 'tool',
          content: '✅ MARK DONE\n\n1. ✅ Task Three',
          tool_call_id: 'tool3',
          name: 'todoList'
        },
      ];

      const result = compressor.compressMessages(messages);

      // First two should be replaced with placeholders
      expect(result.messages[1].content).toContain('[Todo item completed');
      expect(result.messages[3].content).toContain('[Todo item completed');
      
      // Last one should have the aggregate summary
      expect(result.messages[5].content).toContain('Progress Summary');
      expect(result.messages[5].content).toContain('Completed 3 item(s)');
      expect(result.messages[5].content).toContain('Task One');
      expect(result.messages[5].content).toContain('Task Two');
      expect(result.messages[5].content).toContain('Task Three');
      
      expect(result.stats.compressedMessages).toBe(3);
    });
  });

  describe('All three strategies together', () => {
    it('should compress todos comprehensively', () => {
      const compressor = new MessageCompressor();
      compressor.registerStrategy(new DuplicateTodoCreateStrategy());
      compressor.registerStrategy(new TodoCreateResultSummarizer());
      compressor.registerStrategy(new TodoMarkDoneAggregator());

      const messages: LLMMessage[] = [
        // Create list v1
        {
          role: 'assistant',
          content: 'Create',
          tool_calls: [{
            id: 'tool1',
            type: 'function',
            function: { 
              name: 'todoList', 
              arguments: JSON.stringify({ 
                operation: 'create_list',
                listName: 'Tasks',
                items: [{ title: 'A' }, { title: 'B' }]
              })
            }
          }]
        },
        { role: 'tool', content: 'VERBOSE CREATE OUTPUT FOR v1...', tool_call_id: 'tool1', name: 'todoList' },
        // Create list v2 (updated)
        {
          role: 'assistant',
          content: 'Update',
          tool_calls: [{
            id: 'tool2',
            type: 'function',
            function: { 
              name: 'todoList', 
              arguments: JSON.stringify({ 
                operation: 'create_list',
                listName: 'Tasks',
                items: [{ title: 'A' }, { title: 'B' }, { title: 'C' }]
              })
            }
          }]
        },
        { role: 'tool', content: 'VERBOSE CREATE OUTPUT FOR v2...', tool_call_id: 'tool2', name: 'todoList' },
        // Mark done A
        {
          role: 'assistant',
          content: 'Done A',
          tool_calls: [{
            id: 'tool3',
            type: 'function',
            function: { name: 'todoList', arguments: JSON.stringify({ operation: 'mark_done' }) }
          }]
        },
        { role: 'tool', content: '✅ MARK DONE\n1. ✅ Task A', tool_call_id: 'tool3', name: 'todoList' },
        // Mark done B
        {
          role: 'assistant',
          content: 'Done B',
          tool_calls: [{
            id: 'tool4',
            type: 'function',
            function: { name: 'todoList', arguments: JSON.stringify({ operation: 'mark_done' }) }
          }]
        },
        { role: 'tool', content: '✅ MARK DONE\n1. ✅ Task B', tool_call_id: 'tool4', name: 'todoList' },
      ];

      const result = compressor.compressMessages(messages);

      // v1 create: duplicate removed
      expect(result.messages[1].content).toContain('[Duplicate todo list create removed');
      
      // v2 create: result summarized
      expect(result.messages[3].content).toContain('Created todo list: "Tasks" with 3 items');
      expect(result.messages[3].content).toContain('[Full list details available');
      
      // Mark done A: replaced with placeholder
      expect(result.messages[5].content).toContain('[Todo item completed');
      
      // Mark done B: aggregate summary
      expect(result.messages[7].content).toContain('Progress Summary');
      expect(result.messages[7].content).toContain('2 item(s)');
      
      expect(result.stats.compressedMessages).toBe(4);
    });
  });
});
