import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MODULAR_PROMPT_FILES,
  parseModularPromptFilesCsv,
  parseModularPromptFilesFromProfileProperty,
  profileDefinesCustomModularPromptFiles,
} from '../modular-prompt-files.js';
import type { ProfileData } from '../../profiles/types.js';

describe('modular-prompt-files', function modularPromptFilesTests() {
  function prof(props: ProfileData['properties']): ProfileData {
    return { name: 't', description: '', properties: props };
  }

  it('profileDefinesCustomModularPromptFiles is false for absent key', function absentKey() {
    expect(profileDefinesCustomModularPromptFiles(prof({}))).toBe(false);
  });

  it('profileDefinesCustomModularPromptFiles is false for null property', function nullProp() {
    expect(profileDefinesCustomModularPromptFiles(prof({ 'initial.modularPromptFiles': null }))).toBe(false);
  });

  it('profileDefinesCustomModularPromptFiles is false for boolean property', function boolProp() {
    expect(profileDefinesCustomModularPromptFiles(prof({ 'initial.modularPromptFiles': false }))).toBe(false);
  });

  it('profileDefinesCustomModularPromptFiles is false for whitespace-only comma CSV', function whitespaceCommaGate() {
    expect(profileDefinesCustomModularPromptFiles(prof({ 'initial.modularPromptFiles': ' , ' }))).toBe(false);
  });

  it('profileDefinesCustomModularPromptFiles is true when at least one token is non-empty', function oneToken() {
    expect(profileDefinesCustomModularPromptFiles(prof({ 'initial.modularPromptFiles': ' , identity.md' }))).toBe(true);
  });

  it('parseModularPromptFilesCsv rejects path segments', function rejectsTraversal() {
    expect(() => parseModularPromptFilesCsv('../../shared/security.md')).toThrow(/Invalid modular prompt filename/);
  });

  it('parseModularPromptFilesCsv rejects traversal in a later CSV token', function rejectsMixedTraversal() {
    expect(() => parseModularPromptFilesCsv('identity.md, ../evil.md')).toThrow(/Invalid modular prompt filename/);
  });

  it('parseModularPromptFilesCsv falls back to defaults for whitespace-only CSV tokens', function emptyCsvTokens() {
    const files = parseModularPromptFilesCsv(' , , ');
    expect(files).toEqual([
      'identity.md',
      'questioning.md',
      'project-name.md',
      'design-direction.md',
      'design-reference.md',
      'feature-list.md',
      'handoff-template.md',
      'examples.md',
    ]);
  });

  it('parseModularPromptFilesFromProfileProperty falls back to defaults for whitespace-only profile value', function profilePropertyParse() {
    const profile: ProfileData = {
      name: 'p',
      description: '',
      properties: { 'initial.modularPromptFiles': ' , , ' },
    };
    expect(parseModularPromptFilesFromProfileProperty(profile)).toEqual([...DEFAULT_MODULAR_PROMPT_FILES]);
  });
});
