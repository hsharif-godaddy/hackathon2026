import AsyncIcon from '@ux/icon/async-icon.js';
import figma from '@figma/code-connect';
import { CtaButton } from './CtaButton';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=108-72
figma.connect(
  CtaButton,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=108-72',
  {
    props: {
      title: figma.string('title'),
      description: figma.string('description'),
      helperText: figma.string('helperText'),
      processingMessage: figma.string('processingMessage'),
      successMessage: figma.string('successMessage'),
      errorLabel: figma.string('errorLabel'),
      errorMessage: figma.string('errorMessage'),
      actionLabel: figma.string('actionLabel'),
      retryLabel: figma.string('retryLabel'),
      cancelLabel: figma.string('cancelLabel'),
      status: figma.enum('Status', {
        Pending: 'pending',
        Processing: 'processing',
        Success: 'success',
        Error: 'error',
      }),
      borderless: figma.boolean('borderless'),
    },
    example: ({
      title,
      description,
      helperText,
      processingMessage,
      successMessage,
      errorLabel,
      errorMessage,
      actionLabel,
      retryLabel,
      cancelLabel,
      status,
      borderless,
    }) => (
      <CtaButton
        icon={<AsyncIcon icon="user-locked" />}
        title={title}
        description={description}
        helperText={helperText}
        processingMessage={processingMessage}
        successMessage={successMessage}
        errorLabel={errorLabel}
        errorMessage={errorMessage}
        actionLabel={actionLabel}
        retryLabel={retryLabel}
        cancelLabel={cancelLabel}
        status={status}
        borderless={borderless}
        onAction={() => {}}
        onClose={() => {}}
      />
    ),
  },
);
