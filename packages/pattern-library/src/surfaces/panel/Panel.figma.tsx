import figma from '@figma/code-connect';
import { Panel } from './Panel';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=171-104
figma.connect(
  Panel,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=171-104',
  {
    props: {
      // The Figma `position` axis (leading|trailing) is a layout-mirror
      // of the source CSS `--leading` / `--trailing` modifiers. The
      // React component itself takes no `position` prop — left/right
      // attachment is driven by RTL + a className modifier, so this
      // example just renders the trailing-edge default.
      showDisrupt: figma.boolean('showDisrupt'),
    },
    example: ({ showDisrupt }) => (
      <Panel title="Panel title" showDisrupt={showDisrupt} onClose={() => {}}>
        <p>Panel body content.</p>
      </Panel>
    ),
  },
);
