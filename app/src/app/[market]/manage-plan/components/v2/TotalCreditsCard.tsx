"use client";

import { FormattedMessage } from "react-intl";
import text from "@ux/text";

import { useTranslations } from "@/hooks/useTranslations";
import { getRootDomain } from "@/utils/getRootDomain";
import { CreditsProgressBar } from "./CreditsProgressBar";

interface TotalCreditsCardProps {
  totalCreditsSpent: number;
  totalCreditsMax: number;
  totalCreditsLeft: number;
}

export default function TotalCreditsCard({
  totalCreditsSpent,
  totalCreditsMax,
  totalCreditsLeft,
}: TotalCreditsCardProps) {
  const t = useTranslations();
  const rootDomain: string = getRootDomain();

  return (
    <>
      <div className="flex flex-col gap-1">
        <text.h3 as="title" size={2} text={t("builder_manageplan_total_credits_title")} />

        <text.p as="paragraph" size={-1}>
          <FormattedMessage
            id="builder_manageplan_total_credits_description"
            values={{
              creditLink: (chunks) => (
                <a
                  href={`https://www.${rootDomain}/help/godaddy-airo-ai-builder-credits-faq-42828`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-ai-light"
                >
                  {chunks}
                </a>
              ),
              promptLink: (chunks) => (
                <a
                  href={`https://www.${rootDomain}/help/godaddy-airo-ai-builder-prompt-best-practices-42854`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-ai-light"
                >
                  {chunks}
                </a>
              ),
            }}
          />
        </text.p>
      </div>
      <CreditsProgressBar label={t("builder_manageplan_total_credits_usage")} spent={totalCreditsSpent} left={totalCreditsLeft} max={totalCreditsMax} progressBarColor="color-ai-bright" size="md" />
    </>
  );
}
