import React from 'react';
import Box from '@ux/box';
import Button from '@ux/button';
import Card from '@ux/card';

interface FeatureCardProps {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  children?: React.ReactNode;
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
      <div className="flex w-full min-w-0 gap-2">
        <div className="shrink-0">{iconElement}</div>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="mb-0.5 min-w-0 truncate text-sm font-semibold leading-tight">
            {title}
          </span>
          {children != null ? <div className="mb-1 shrink-0 w-fit">{children}</div> : null}
          <p className="m-0 w-full min-w-0 text-sm leading-relaxed text-intents-ux-neutral-foregroundColor">
            {description}
          </p>
        </div>
      </div>
    </Card>
  );
}
