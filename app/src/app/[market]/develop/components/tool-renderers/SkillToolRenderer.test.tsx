/**
 * @vitest-environment jsdom
 */
import '@testing-library/jest-dom';

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import SkillToolRenderer from './SkillToolRenderer';

vi.mock('@/lib/request-context', () => ({
  logger: { error: vi.fn() },
}));

describe('SkillToolRenderer', () => {
  it('renders UI as an acronym when loading commerce-ui', () => {
    render(
      <SkillToolRenderer
        toolName="skill"
        toolStatus="completed"
        input={{ action: 'load', skill: 'commerce-ui' }}
        result={{ skill: 'commerce-ui' }}
      />
    );

    expect(screen.getByText('Loaded skill: Commerce Ui')).toBeInTheDocument();
  });

  it('renders UI as an acronym when installing commerce-ui', () => {
    render(
      <SkillToolRenderer
        toolName="skill"
        toolStatus="completed"
        input={{ action: 'install', skill: 'commerce-ui' }}
        result={{
          skill: 'commerce-ui',
          filesInstalled: 15,
          installedFiles: [],
        }}
      />
    );

    expect(screen.getByText('Installed Commerce Ui (15 files)')).toBeInTheDocument();
  });
});
