import figma from '@figma/code-connect';
import { MentionChip } from './MentionChip';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=88-51
figma.connect(
  MentionChip,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=88-51',
  {
    props: {
      prefix: figma.string('prefix'),
      label: figma.string('label'),
      removeLabel: figma.string('removeLabel'),
      // There is no `interactive` prop — a chip is interactive when it has an
      // `onActivate` handler, so model the Figma boolean as the handler's
      // presence/absence (same pattern as `onRemove` below).
      onActivate: figma.boolean('interactive', { true: () => {}, false: undefined }),
      // The Has Remove boolean drives whether onRemove is wired.
      onRemove: figma.boolean('Has Remove', { true: () => {}, false: undefined }),
    },
    example: ({ prefix, label, removeLabel, onActivate, onRemove }) => (
      <MentionChip
        prefix={prefix}
        label={label}
        removeLabel={removeLabel}
        onActivate={onActivate}
        onRemove={onRemove}
      />
    ),
  },
);
