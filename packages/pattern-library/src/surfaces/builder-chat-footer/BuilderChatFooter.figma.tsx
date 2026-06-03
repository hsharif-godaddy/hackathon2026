import figma from '@figma/code-connect';
import { BuilderChatFooter } from './BuilderChatFooter';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=130-77
figma.connect(
  BuilderChatFooter,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=130-77',
  {
    props: {},
    example: () => <BuilderChatFooter />,
  },
);
