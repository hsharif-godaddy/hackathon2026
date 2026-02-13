import React from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import Card from '@ux/card';
import TextLockup from '@ux/text-lockup';

interface FeatureCardProps {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  'aria-checked'?: boolean;
  'aria-label'?: string;
}

export function FeatureCard({
  id,
  icon,
  title,
  description,
  children,
  checked,
  onChange,
  ...props
}: FeatureCardProps) {
  const iconElement = (
    <Box
      className="bg-intents-ux-boxLowContrast-backgroundColor rounded-lg size-6 shrink-0"
      blockAlignChildren="center"
      inlineAlignChildren="center"
    >
      {icon}
    </Box>
  );

  return (
    <Card
      id={id}
      as="checkbox"
      tabIndex={0}
      checked={checked}
      onChange={onChange}
      cornerActions={
        <Button
          as="checkbox"
          active={checked}
          onClick={(e) => {
            e.stopPropagation();
            onChange(!checked);
          }}
          size="sm"
        />
      }
      space={{
        block: "md",
        inline: "md",
      }}
      {...props}
     >
      {/* 
        * Using a div with Tailwind classes here because @ux/box isn't flexible
        * enough to support the desired layout change across breakpoints.
        */}
      <div className="flex flex-col-reverse md:flex-row gap-1 justify-between">
        <Box orientation="horizontal" gap="sm">
          {iconElement}
          <TextLockup
            title={title}
            size="sm"
            >
            {description}
          </TextLockup>
        </Box>
        {children}
      </div>
    </Card>
  );
}
