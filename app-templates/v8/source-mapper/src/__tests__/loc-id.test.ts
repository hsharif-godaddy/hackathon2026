import { arrayDeclaratorLocId } from '../loc-id.js';

it('derives L<line>C<col> from a node loc', () => {
  expect(arrayDeclaratorLocId({ start: { line: 22, column: 8 } })).toBe('L22C8');
});

it('returns null when loc is missing', () => {
  expect(arrayDeclaratorLocId(null)).toBeNull();
  expect(arrayDeclaratorLocId(undefined)).toBeNull();
});
