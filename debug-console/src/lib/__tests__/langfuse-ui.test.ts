import { describe, expect, it } from 'vitest';

import { fullStorySessionUrl } from '../langfuse-ui';

describe('fullStorySessionUrl', () => {
    it('builds a client-session replay URL from the already-encoded triplet', () => {
        const id =
            'd5efdfc0-d226-4448-b43b-b17c5eb7c45c%3A0200d232-8535-49dc-bbc1-8f7615c0521e%3A1781289691011';
        expect(fullStorySessionUrl(id)).toBe(
            `https://app.fullstory.com/ui/YKBRC/client-session/${id}`,
        );
    });

    it('does not re-encode the percent-encoded colons', () => {
        const url = fullStorySessionUrl('a%3Ab%3A123');
        expect(url).toContain('a%3Ab%3A123');
        expect(url).not.toContain('%253A');
    });
});
