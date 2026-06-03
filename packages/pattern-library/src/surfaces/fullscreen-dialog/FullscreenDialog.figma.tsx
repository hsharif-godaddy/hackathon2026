import figma from '@figma/code-connect';
import { FullscreenDialog } from './FullscreenDialog';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=128-9
figma.connect(
  FullscreenDialog,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=128-9',
  {
    props: {},
    example: () => (
      <FullscreenDialog title="Dialog title" onClose={() => {}}>
        <p>Dialog body content.</p>
      </FullscreenDialog>
    ),
  },
);
