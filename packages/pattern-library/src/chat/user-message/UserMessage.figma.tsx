import figma from '@figma/code-connect';
import { UserMessage } from './UserMessage';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=116-34
figma.connect(
  UserMessage,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=116-34',
  {
    props: {
      // Figma `Content` variant signals which attachments-gallery layout the
      // user message should render with.
      content: figma.enum('Content', {
        'Text Only': 'text-only',
        'Strip Gallery': 'strip',
        'List Gallery': 'list',
      }),
    },
    example: ({ content }) =>
      content === 'text-only' ? (
        <UserMessage>What changes do you suggest for the hero section?</UserMessage>
      ) : (
        <UserMessage>
          <UserMessage.Gallery layout={content}>
            <UserMessage.Image src="/mockup.png" alt="Hero section mockup" />
          </UserMessage.Gallery>
          What changes do you suggest for the hero section?
        </UserMessage>
      ),
  },
);
