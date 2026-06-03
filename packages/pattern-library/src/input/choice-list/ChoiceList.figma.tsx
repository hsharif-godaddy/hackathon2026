import figma from '@figma/code-connect';
import { ChoiceList } from './ChoiceList';
import { ChoiceListItem } from './ChoiceListItem';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=154-17
figma.connect(
  ChoiceList,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=154-17',
  {
    props: {
      title: figma.string('title'),
      otherPlaceholder: figma.string('otherPlaceholder'),
      skipLabel: figma.string('skipLabel'),
      continueLabel: figma.string('continueLabel'),
      backLabel: figma.string('backLabel'),
      forwardLabel: figma.string('forwardLabel'),
      closeLabel: figma.string('closeLabel'),
      allowOther: figma.boolean('allowOther'),
      disabled: figma.boolean('disabled'),
      optionDividers: figma.boolean('optionDividers'),
    },
    example: ({
      title,
      otherPlaceholder,
      skipLabel,
      continueLabel,
      backLabel,
      forwardLabel,
      closeLabel,
      allowOther,
      disabled,
      optionDividers,
    }) => (
      <ChoiceList
        title={title}
        otherPlaceholder={otherPlaceholder}
        // `stepIndicatorLabel` is a formatter `(current, total) => string`,
        // not a static label, so it can't be mapped from a Figma string prop.
        stepIndicatorLabel={(current, total) => `Step ${current} of ${total}`}
        skipLabel={skipLabel}
        continueLabel={continueLabel}
        backLabel={backLabel}
        forwardLabel={forwardLabel}
        closeLabel={closeLabel}
        allowOther={allowOther}
        disabled={disabled}
        optionDividers={optionDividers}
        onClose={() => {}}
        onDecision={() => {}}
      >
        <ChoiceListItem value="opt-1">Option one</ChoiceListItem>
        <ChoiceListItem value="opt-2">Option two</ChoiceListItem>
        <ChoiceListItem value="opt-3">Option three</ChoiceListItem>
      </ChoiceList>
    ),
  },
);
