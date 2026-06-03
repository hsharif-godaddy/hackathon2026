import figma from '@figma/code-connect';
import { ThinkingIndicator } from './ThinkingIndicator';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=82-17
figma.connect(
  ThinkingIndicator,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=82-17',
  {
    props: {
      variant: figma.enum('Variant', {
        Dots: 'dots',
        Spinner: 'spinner',
        GoDaddy: 'godaddy',
      }),
    },
    example: ({ variant }) => <ThinkingIndicator variant={variant} />,
  },
);
