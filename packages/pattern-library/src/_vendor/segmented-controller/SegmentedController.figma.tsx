import figma from '@figma/code-connect';
import {
  SegmentedController,
  SegmentedControllerItem,
} from './SegmentedController';

// Parent — Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=205-251
figma.connect(
  SegmentedController,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=205-251',
  {
    props: {
      size: figma.enum('Size', {
        sm: 'sm',
        md: 'md',
        lg: 'lg',
      }),
      // Figma `Selected` variant pre-selects an item by 1-based index;
      // map onto the React `value`/`defaultValue` (item id).
      selected: figma.enum('Selected', {
        '1': 'item-1',
        '2': 'item-2',
        '3': 'item-3',
      }),
    },
    example: ({ size, selected }) => (
      <SegmentedController size={size} value={selected} onSelectionChange={() => {}}>
        <SegmentedControllerItem value="item-1">Inbox</SegmentedControllerItem>
        <SegmentedControllerItem value="item-2">Email</SegmentedControllerItem>
        <SegmentedControllerItem value="item-3">Bell</SegmentedControllerItem>
      </SegmentedController>
    ),
  },
);

// Item — Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=141-167
figma.connect(
  SegmentedControllerItem,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=141-167',
  {
    props: {
      label: figma.string('children'),
      hasIcon: figma.boolean('Has Icon'),
      hasLabel: figma.boolean('Has Label'),
    },
    example: ({ label }) => (
      <SegmentedControllerItem value={label.toLowerCase()}>{label}</SegmentedControllerItem>
    ),
  },
);
