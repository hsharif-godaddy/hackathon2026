import figma from '@figma/code-connect';
import { Thinker } from './Thinker';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=114-67
figma.connect(
  Thinker,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=114-67',
  {
    props: {
      label: figma.string('label'),
      // Figma `State` variant condenses runtime state across two booleans:
      // working/done and panel-open/panel-closed. Only the working/done axis
      // maps to a React prop (`showAnimation`).
      showAnimation: figma.enum('State', {
        Working: true,
        'Working + Panel Closed': true,
        'Working + Panel Open': true,
        Done: false,
      }),
    },
    example: ({ label, showAnimation }) => (
      <Thinker label={label} showAnimation={showAnimation} />
    ),
  },
);
