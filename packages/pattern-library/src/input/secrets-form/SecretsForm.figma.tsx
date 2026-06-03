import figma from '@figma/code-connect';
import { SecretsForm } from './SecretsForm';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=115-50
figma.connect(
  SecretsForm,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=115-50',
  {
    props: {
      eyebrowLabel: figma.string('eyebrowLabel'),
      label: figma.string('label'),
      placeholder: figma.string('placeholder'),
      helperText: figma.string('helperText'),
      errorMessage: figma.string('errorMessage'),
      submitLabel: figma.string('submitLabel'),
      cancelLabel: figma.string('cancelLabel'),
      closeLabel: figma.string('closeLabel'),
      variant: figma.enum('Variant', {
        Composer: 'composer',
        Conversation: 'conversation',
      }),
    },
    example: ({
      eyebrowLabel,
      label,
      placeholder,
      helperText,
      errorMessage,
      submitLabel,
      cancelLabel,
      closeLabel,
      variant,
    }) => (
      <SecretsForm
        variant={variant}
        eyebrowLabel={eyebrowLabel}
        label={label}
        placeholder={placeholder}
        helperText={helperText}
        errorMessage={errorMessage}
        submitLabel={submitLabel}
        cancelLabel={cancelLabel}
        closeLabel={closeLabel}
        onSubmit={() => {}}
        onCancel={() => {}}
      />
    ),
  },
);
