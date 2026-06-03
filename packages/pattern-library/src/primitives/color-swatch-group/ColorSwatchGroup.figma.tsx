import figma from '@figma/code-connect';
import { ColorSwatchGroup } from './ColorSwatchGroup';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=80-38
figma.connect(
  ColorSwatchGroup,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=80-38',
  {
    props: {
      size: figma.enum('Size', {
        '16': 16,
        '24': 24,
        '40': 40,
      }),
    },
    example: ({ size }) => (
      <ColorSwatchGroup
        size={size}
        colors={[
          { value: '#1a73e8' },
          { value: '#34a853' },
          { value: '#fbbc04' },
        ]}
      />
    ),
  },
);
