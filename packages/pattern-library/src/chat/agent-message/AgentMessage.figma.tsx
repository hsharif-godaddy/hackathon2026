import figma from '@figma/code-connect';
import { AgentMessage } from './AgentMessage';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=117-47
figma.connect(
  AgentMessage,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=117-47',
  {
    props: {
      // Figma `Content` variant captures different markdown shapes the
      // agent can return. The runtime renders the same component; this
      // example surfaces the simplest paragraph form.
      content: figma.enum('Content', {
        Paragraph: 'A short reply paragraph from the agent.',
        'Title + Paragraph':
          '## Section title\n\nA paragraph that follows the title.',
        'Bullet List': '- First point\n- Second point\n- Third point',
        'Code Block':
          '```ts\nconst hello = "world";\nconsole.log(hello);\n```',
        'Rich Sample':
          '## Plan\n\n- Step one\n- Step two\n\n```ts\ndoIt();\n```',
      }),
    },
    example: ({ content }) => <AgentMessage>{content}</AgentMessage>,
  },
);
