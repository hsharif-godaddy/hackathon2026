import figma from '@figma/code-connect';
import { PromptStage } from './PromptStage';
import { PromptBox } from '../prompt-box/PromptBox';

// Figma: https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=113-7
figma.connect(
  PromptStage,
  'https://www.figma.com/design/bCCejvkjSHkRiWeYREUUnK/?node-id=113-7',
  {
    props: {},
    example: () => (
      <PromptStage>
        <PromptBox placeholder="Ask anything…" onSubmit={() => {}} />
      </PromptStage>
    ),
  },
);
