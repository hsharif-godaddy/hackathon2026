import figma from '@figma/code-connect';
import { Canvas } from './Canvas';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=185-34
figma.connect(
  Canvas,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=185-34',
  {
    props: {
      // Figma `State` variants are runtime conditions on the `status` slot;
      // map each to a representative status node.
      status: figma.enum('State', {
        Live: undefined,
        Building: <Canvas.Status label="Generating preview…" />,
        Error: <Canvas.Status label="Generation failed" tone="error" />,
      }),
    },
    example: ({ status }) => <Canvas status={status}>{/* preview iframe */}</Canvas>,
  },
);
