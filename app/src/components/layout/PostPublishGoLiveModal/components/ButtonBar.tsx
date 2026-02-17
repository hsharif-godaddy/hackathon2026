import React, { memo } from 'react';
import Box from '@ux/box';

interface ButtonBarProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Component for displaying a horizontal bar of buttons at the bottom
 * of modal steps. Buttons are aligned to the end and wrap when needed.
 */
export const ButtonBar = memo(function ButtonBar({
  children,
  className
}: ButtonBarProps) {
  return (
    <Box
      className={className}
      orientation="horizontal"
      blockAlignChildren="end"
      gap="md"
      wrap
    >
      {children}
    </Box>
  );
});
