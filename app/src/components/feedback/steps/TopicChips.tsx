import Box from '@ux/box';
import Chip from '@ux/chip';
import text from '@ux/text';

import { useTranslations } from '@/hooks/useTranslations';
import type { TopicOption } from '../utils';

interface SingleSelectProps {
  label: string;
  topics: TopicOption[];
  multi?: false;
  selected: string | null;
  onChange: (topic: string | null) => void;
}

interface MultiSelectProps {
  label: string;
  topics: TopicOption[];
  multi: true;
  selected: Set<string>;
  onChange: (topics: Set<string>) => void;
}

type TopicChipsProps = SingleSelectProps | MultiSelectProps;

export function TopicChips(props: TopicChipsProps) {
  const { label, topics, multi } = props;
  const t = useTranslations();

  const handleSelect = (key: string) => {
    if (multi) {
      const { selected, onChange } = props as MultiSelectProps;
      const next = new Set(selected);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      onChange(next);
    } else {
      const { selected, onChange } = props as SingleSelectProps;
      onChange(selected === key ? null : key);
    }
  };

  const isSelected = (key: string) => {
    if (multi) {
      return (props as MultiSelectProps).selected.has(key);
    }
    return (props as SingleSelectProps).selected === key;
  };

  return (
    <Box gap="sm">
      <text.p size={-1} emphasis="passive">
        {label}
      </text.p>
      <Box orientation="horizontal" gap="sm" className="flex-wrap">
        {topics.map((topic) => (
          <Chip
            key={topic.key}
            label={t(topic.i18nKey)}
            selected={isSelected(topic.key)}
            onSelect={() => handleSelect(topic.key)}
          />
        ))}
      </Box>
    </Box>
  );
}
