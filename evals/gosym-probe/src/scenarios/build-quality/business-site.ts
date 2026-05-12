import { createBuildQualityScenario }
  from './create-build-quality-scenario.js';
import type { GocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';

const STATIC_PROMPT = [
  'Build a website for my landscaping business',
  '"GreenScape Landscaping" with:',
  '- Hero section with a headline and a call-to-action',
  '  button',
  '- Services grid showing 4 services: lawn care, tree',
  '  trimming, garden design, and irrigation',
  '- Customer testimonials section with 3 reviews',
  '- Contact form with name, email, phone, and message',
  '  fields',
  'Use a professional green and white color scheme.',
].join('\n');

export function businessSiteScenario(
  gocode: GocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createBuildQualityScenario(
    {
      name: 'business-site',
      staticFirstMessage: STATIC_PROMPT,
      goals: [
        {
          description:
            'The agent creates a business website with a hero ' +
            'section, a services grid, customer testimonials, ' +
            'and a contact form',
          assertion: 'positive',
        },
        {
          description:
            'The agent reuses a shared layout for header and ' +
            'footer rather than duplicating markup across ' +
            'sections',
          assertion: 'positive',
        },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
