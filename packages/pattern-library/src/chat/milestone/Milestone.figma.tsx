import figma from '@figma/code-connect';
import { Milestone } from './Milestone';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=118-36
figma.connect(
  Milestone,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=118-36',
  {
    props: {
      label: figma.string('label'),
      // The Has Actions / Has Feedback booleans drive whether those slots are
      // wired; map each to a representative value or omit it.
      actions: figma.boolean('Has Actions', {
        true: [{ id: 'undo', label: 'Undo', onSelect: () => {} }],
        false: undefined,
      }),
      feedback: figma.boolean('Has Feedback', {
        true: { onChange: () => {} },
        false: undefined,
      }),
      // Figma `State` variant covers both whether the details panel exists
      // and whether it's open.
      defaultOpen: figma.enum('State', {
        Default: undefined,
        'With Details Closed': false,
        'With Details Open': true,
      }),
    },
    example: ({ label, actions, feedback, defaultOpen }) => (
      <Milestone
        label={label}
        actions={actions}
        feedback={feedback}
        defaultOpen={defaultOpen}
      />
    ),
  },
);
