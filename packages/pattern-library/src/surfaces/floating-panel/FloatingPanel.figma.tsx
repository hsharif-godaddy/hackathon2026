import figma from '@figma/code-connect';
import { FloatingPanel } from './FloatingPanel';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=181-75
figma.connect(
  FloatingPanel,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=181-75',
  {
    props: {
      // Figma `dockedTo` axis maps to the React prop. `floating` (free
      // position) and `zone` (embedded in a host content area) have no
      // docked target — both render with `dockedTo` omitted. `left`/`right`
      // map to the edge-pinned values.
      dockedTo: figma.enum('dockedTo', {
        floating: undefined,
        left: 'left',
        right: 'right',
        zone: undefined,
      }),
    },
    example: ({ dockedTo }) => (
      <FloatingPanel title="Floating panel" dockedTo={dockedTo} onClose={() => {}}>
        <p>Panel body.</p>
      </FloatingPanel>
    ),
  },
);
