import { createGoldenLightScenario }
  from './create-golden-light-scenario.js';
import type { IGocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';

const STATIC_PROMPT = [
  'Build me a personal portfolio website with:',
  '- A hero section with my name and a short tagline',
  '- An about section describing my background',
  '- A contact section with an email link and social',
  '  media icons',
  'Use a clean, modern design with good spacing.',
].join('\n');

export function simplePortfolioScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createGoldenLightScenario(
    {
      name: 'simple-portfolio',
      staticFirstMessage: STATIC_PROMPT,
      goals: [
        {
          description:
            'The agent creates a personal portfolio site with ' +
            'a hero section, an about section, and a contact ' +
            'section',
          assertion: 'positive',
        },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
