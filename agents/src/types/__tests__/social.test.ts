import { describe, it, expect } from 'vitest';
import { PostState, isPostState, getAllPostStates } from '../social.js';

describe('PostState', () => {
  it('includes a DRAFT member equal to "DRAFT"', () => {
    expect(PostState.DRAFT).toBe('DRAFT');
  });

  it('isPostState accepts "DRAFT"', () => {
    expect(isPostState('DRAFT')).toBe(true);
  });

  it('isPostState rejects a non-member', () => {
    expect(isPostState('NONSENSE')).toBe(false);
  });

  it('getAllPostStates contains DRAFT alongside the publish states', () => {
    expect(getAllPostStates()).toEqual(
      expect.arrayContaining([PostState.DRAFT, PostState.SCHEDULED, PostState.PUBLISHED, PostState.FAILED]),
    );
  });
});
