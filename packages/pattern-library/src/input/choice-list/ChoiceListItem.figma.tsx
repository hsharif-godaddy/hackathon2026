import figma from '@figma/code-connect';
import { ChoiceListItem } from './ChoiceListItem';

// Single-select Choice List Item — Figma `Choice List Item` set with the
// numeric Tag badge.
//
// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=153-54
figma.connect(
  ChoiceListItem,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=153-54',
  {
    props: {
      // `letter` is the visible badge override (ChoiceList auto-assigns one
      // when omitted). The option label is the item's `children`; rich
      // descriptions compose via `<ChoiceListItemContent>` when needed.
      letter: figma.string('letter'),
    },
    example: ({ letter }) => (
      <ChoiceListItem value={`opt-${letter}`} letter={letter}>
        {`Option ${letter}`}
      </ChoiceListItem>
    ),
  },
);

// Multi-select Choice List Item — Figma `Choice List Item · Multi-Select`
// set; rendered when the parent step uses `selectionMode="multiple"`.
//
// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=236-391
figma.connect(
  ChoiceListItem,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=236-391',
  {
    props: {
      // The option label is the item's `children`. There is no `description`
      // prop on ChoiceListItem; rich content composes via
      // `<ChoiceListItemContent>` inside the item when a step needs it.
      label: figma.string('label'),
    },
    example: ({ label }) => (
      <ChoiceListItem value={`opt-${label}`}>{label}</ChoiceListItem>
    ),
  },
);
