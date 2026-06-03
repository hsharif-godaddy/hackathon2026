import figma from '@figma/code-connect';
import { FloatingFooter } from './FloatingFooter';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=126-5
figma.connect(
  FloatingFooter,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=126-5',
  {
    props: {},
    example: () => (
      <FloatingFooter>
        <button type="button">Cancel</button>
        <button type="button">Save draft</button>
        <button type="button">Publish</button>
      </FloatingFooter>
    ),
  },
);
