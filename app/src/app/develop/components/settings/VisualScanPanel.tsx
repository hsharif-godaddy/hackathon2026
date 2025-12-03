/**
 * TODO: Implement Visual Scans page functionality
 *
 * The Visual Scans page can be implemented using the Visual and Accessibility TestPilot tests.
 * The UI should follow the pattern established by the Security Scans page (SecurityPanel.tsx and SecurityResults.tsx).
 *
 * Implementation steps:
 * 1. Add state management similar to SecurityPanel (loading, results, error states)
 * 2. Call TestPilot API with 'visual' and 'accessibility' test types
 * 3. Create VisualResults component similar to SecurityResults to display findings
 * 4. Follow the same pattern for vulnerability cards and TODO list integration
 *
 * Reference files:
 * - app/src/app/develop/components/settings/SecurityPanel.tsx
 * - app/src/app/develop/components/settings/components/security/SecurityResults.tsx
 * - app/src/app/api/testpilot/route.ts (lines 44-52 for visual/accessibility tests)
 */

import BigCard from "@/components/layout/BigCard.tsx";
import Box from '@ux/box';
import Button from '@ux/button';
import WandIcon from '@ux/icon/wand';
import Card from '@ux/card';

export default function VisualScanPanel() {
  return (
    <Box gap="lg" className="@container">
      <BigCard
        title="Visual Scan"
        description="Scan your application for design inconsistencies and accessibility issues."
        button={<Button
          design="primary"
          icon={<WandIcon />}
          disabled
        >
          Run Scan
        </Button>}>
        <Card>
          <p>
            No scan results
          </p>
        </Card>
      </BigCard>
    </Box>
  )
}
