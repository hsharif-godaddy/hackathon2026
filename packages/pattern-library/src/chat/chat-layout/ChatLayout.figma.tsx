import figma from '@figma/code-connect';
import { ChatLayout } from './ChatLayout';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=119-68
figma.connect(
  ChatLayout,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=119-68',
  {
    props: {
      layout: figma.enum('Layout', {
        Centered: 'centered',
        Sidebar: 'sidebar',
      }),
    },
    example: ({ layout }) => (
      <ChatLayout layout={layout}>
        <p>Chat content goes here.</p>
      </ChatLayout>
    ),
  },
);
