import figma from '@figma/code-connect';
import { DragHandle } from './DragHandle';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=75-13
figma.connect(
  DragHandle,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=75-13',
  {
    props: {
      orientation: figma.enum('Orientation', {
        Horizontal: 'horizontal',
        Vertical: 'vertical',
      }),
    },
    example: ({ orientation }) => <DragHandle orientation={orientation} />,
  },
);
