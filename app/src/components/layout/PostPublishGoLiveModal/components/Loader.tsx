import React from 'react';
import Box from '@ux/box';
import Spinner from '@ux/spinner';
import text from '@ux/text';
import TextLockup from '@ux/text-lockup';

interface LoaderProps {
  title: string;
  description: React.ReactNode;
}

/**
 * Component for displaying a loading state with a title and description.
 */
export function Loader({
  title,
  description
}: LoaderProps) {
  return (
    <Box gap="lg">
      <Spinner size="md" />
      <TextLockup title={title} centered>
        <text.p emphasis="passive">{description}</text.p>
      </TextLockup>
    </Box>
  );
}
