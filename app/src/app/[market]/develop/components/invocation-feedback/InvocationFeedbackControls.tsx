'use client';

import clsx from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import ThumbsDownIcon from '@ux/icon/thumbs-down';
import ThumbsUpIcon from '@ux/icon/thumbs-up';
import ThumbsUpFilledIcon from '@ux/icon/thumbs-up-filled';

import ResponseMetadataActionButton from '@/app/[market]/develop/components/ResponseMetadataActionButton';
import { useTranslations } from '@/hooks/useTranslations';
import { generateClickEID } from '@/utils/instrumentation';
import { invocationFeedbackActionIconClass } from './constants';
import { useInvocationFeedback } from './InvocationFeedbackContext';

export default function InvocationFeedbackControls() {
  const t = useTranslations();
  const { feedback, togglePositive, toggleNegative } = useInvocationFeedback();

  return (
    <AnimatePresence>
      {feedback !== 'negative' && (
        <ResponseMetadataActionButton
          key="thumbs-up"
          label={t(
            'builder_chat_response_feedback_positive',
            undefined,
            'This response was helpful'
          )}
          data-eid={generateClickEID('chat.response_metadata.thumbs_up')}
          onClick={togglePositive}
          icon={
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className={clsx(
                feedback === 'positive'
                  ? 'col-start-2 justify-self-center'
                  : 'col-start-1 justify-self-center'
              )}
            >
              {feedback === 'positive' ? (
                <ThumbsUpFilledIcon
                  className={clsx(
                    invocationFeedbackActionIconClass,
                    'text-black hover:text-black active:text-black'
                  )}
                />
              ) : (
                <ThumbsUpIcon className={invocationFeedbackActionIconClass} />
              )}
            </motion.div>
          }
        />
      )}
      {feedback !== 'positive' && (
        <ResponseMetadataActionButton
          key="thumbs-down"
          label={t('builder_chat_response_feedback_negative')}
          data-eid={generateClickEID('chat.response_metadata.thumbs_down')}
          onClick={toggleNegative}
          icon={
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              {feedback === 'negative' ? (
                <ThumbsUpFilledIcon
                  className={clsx(
                    invocationFeedbackActionIconClass,
                    'rotate-180 text-black hover:text-black active:text-black'
                  )}
                />
              ) : (
                <ThumbsDownIcon className={invocationFeedbackActionIconClass} />
              )}
            </motion.div>
          }
        />
      )}
    </AnimatePresence>
  );
}
