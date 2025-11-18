import BigCard from "@/components/layout/BigCard";
import Button from "@ux/button";
import Box from "@ux/box";
import Card from "@ux/card";
import WandIcon from "@ux/icon/wand";

export default function SecurityPanel() {
  return (
    <Box gap="lg" className="@container">
      <BigCard
        title="Security Analysis"
        description="Comprehensive security analysis of site vulnerabilities and code quality"
        button={<Button
        design="primary"
        icon={<WandIcon />}
        disabled
      >
        Run Analysis
      </Button>}>
        <Card>
          <p>
            No results
          </p>
        </Card>
      </BigCard>
    </Box>
  )
}
