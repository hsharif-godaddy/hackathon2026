import figma from '@figma/code-connect';
import { Chiclet } from './Chiclet';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=96-77
figma.connect(
  Chiclet,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=96-77',
  {
    props: {
      // Figma `Size` numeric variants map to the React `size` union
      // (`'medium' | 'small'`): the 36px chip is `small`, the 46px chip is `medium`.
      size: figma.enum('Size', {
        '36': 'small',
        '46': 'medium',
      }),
      children: figma.string('children'),
      hasIcon: figma.boolean('Has Icon'),
      // Disabled state on the Figma variant maps to the HTMLButton disabled prop.
      disabled: figma.enum('State', {
        Default: false,
        Hover: false,
        Active: false,
        'Keyboard Focus': false,
        Disabled: true,
      }),
    },
    example: ({ size, children, disabled }) => (
      <Chiclet size={size} disabled={disabled}>
        {children}
      </Chiclet>
    ),
  },
);
