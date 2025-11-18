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
