import { createSkillEval } from './create-skill-eval.js';
import type { IGocodeClient }
  from '../../clients/gocode-client.js';
import type { AABCtrlPlaneClient }
  from '../../clients/aab-ctrl-plane-client.js';
import type { Scenario } from '../types.js';

/**
 * Reproduces **skill non-selection on Authentication**. The authentication
 * skill installs BetterAuth with deliberately *pinned* versions
 * (`better-auth@1.6.15`, `@opentelemetry/api@1.9.1`) because better-auth's
 * transitive surface has broken builds on silent minor bumps (better-auth
 * #9554/#9811/#9365) — the skill's whole reason for existing is that a
 * hand-rolled auth setup picks up a broken latest version or crashes on the
 * missing OTel peer. The failure mode: the agent hand-rolls JWT/session auth
 * from pretrained knowledge (or `npm i better-auth@latest`) instead of running
 * the skill's install, which also ships complete, do-not-duplicate route files.
 *
 * The user intent uses a listed trigger phrase ("add login") with no mention of
 * "skill", so a model leaning on pretrained patterns will scaffold its own auth.
 *
 * Detection: `expectedSkills: ['authentication']` drives
 * `SkillSelectionEvaluator` — with `SKILL_DIAGNOSTICS=true` a run where the
 * skill never loads scores `fail`; the required `skillInstructions` give the
 * narrow LLM judge an instrumentation-independent second signal.
 *
 * NOTE: needs `SKILL_DIAGNOSTICS=true`, else the skill-load check degrades to
 * `unknown` (dropped from the pass rate).
 */
export function authenticationNonSelectionScenario(
  gocode: IGocodeClient,
  ctrlPlane: AABCtrlPlaneClient,
): Scenario {
  return createSkillEval(
    {
      name: 'skill-non-selection-authentication',
      skill: 'authentication',
      userIntent:
        'I want visitors to be able to sign up and log in to my site with '
        + 'an email and password.',
      goals: [
        {
          description:
            'Agent loads/installs the authentication skill rather than '
            + 'hand-rolling JWT or session auth from pretrained knowledge',
          assertion: 'positive',
        },
        {
          description:
            'Users can sign up and log in with email and password',
          assertion: 'positive',
        },
      ],
      skillInstructions: [
        {
          id: 'uses-authentication-skill',
          instruction:
            'The agent must run skill({ action: \'install\', skill: '
            + '\'authentication\' }) to add auth. It must NOT hand-roll its '
            + 'own JWT/session auth (custom bcrypt + jsonwebtoken handlers, a '
            + 'rolled cookie session) from pretrained knowledge.',
          priority: 'required',
        },
        {
          id: 'no-unpinned-better-auth',
          instruction:
            'The agent must not run an ad-hoc `npm install better-auth` at '
            + 'latest or create additional auth route files under '
            + 'src/server/api/auth/. The skill pins better-auth@1.6.15 + '
            + '@opentelemetry/api@1.9.1 and ships complete route templates '
            + 'because unpinned/hand-wired auth has broken builds repeatedly.',
          priority: 'required',
        },
      ],
    },
    gocode,
    ctrlPlane,
  );
}
