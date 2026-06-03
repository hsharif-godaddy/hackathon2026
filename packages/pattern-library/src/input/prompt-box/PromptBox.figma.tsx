import figma from '@figma/code-connect';
import { PromptBox } from './PromptBox';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=109-24
figma.connect(
  PromptBox,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=109-24',
  {
    props: {
      placeholder: figma.string('placeholder'),
      value: figma.string('value'),
      // Figma `Content` variant collapses three runtime states (empty,
      // typed-but-not-pending, pending request). Map the booleans the
      // React component actually accepts.
      pending: figma.enum('Content', {
        Empty: false,
        Filled: false,
        Pending: true,
      }),
      appearance: figma.enum('appearance', {
        default: 'default',
        borderless: 'borderless',
      }),
    },
    example: ({ placeholder, value, pending, appearance }) => (
      <PromptBox
        placeholder={placeholder}
        value={value}
        pending={pending}
        appearance={appearance}
        onSubmit={() => {}}
        onChange={() => {}}
      />
    ),
  },
);
