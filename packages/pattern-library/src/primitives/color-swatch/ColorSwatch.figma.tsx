import figma from '@figma/code-connect';
import { ColorSwatch } from './ColorSwatch';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=74-17
figma.connect(
  ColorSwatch,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=74-17',
  {
    props: {
      // Figma `Size` variant values are numeric pixel sizes — they map 1:1
      // onto the React `size?: number` prop.
      size: figma.enum('Size', {
        '16': 16,
        '24': 24,
        '40': 40,
      }),
    },
    example: ({ size }) => <ColorSwatch color={{ value: '#1a73e8' }} size={size} />,
  },
);
