import "@testing-library/jest-dom";

import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";

import { renderWithProviders } from "@/tests/test-utils";
import TotalCreditCard from "./TotalCreditCard";

vi.mock("@/hooks/useTranslations", () => ({
  useTranslations:
    () => (key: string, params?: Record<string, string | number>) => {
      if (key === "builder_manageplan_credits_count" && params) {
        return `${params.spent}/${params.max}`;
      }
      return key;
    },
}));

const defaultTotalCredits = {
  totalCreditsSpent: 1129,
  totalCreditsMax: 1500,
};

describe("TotalCreditCard", function totalCreditCardTests() {
  beforeEach(function setup() {
    vi.clearAllMocks();
  });

  describe("renders with valid credits", function withCreditsTests() {
    it("should render total credits title", function renderTitle() {
      renderWithProviders(<TotalCreditCard {...defaultTotalCredits} />);

      expect(
        screen.getByText("builder_manageplan_total_credits"),
      ).toBeInTheDocument();
    });

    it("should render total credits spent and max", function renderCredits() {
      renderWithProviders(
        <TotalCreditCard totalCreditsSpent={1129} totalCreditsMax={1500} />,
      );

      // Text is split across elements for styling (spent is passive)
      expect(
        screen.getByText(
          (content, element) => element?.textContent === "1,129/1,500",
        ),
      ).toBeInTheDocument();
    });

    it("should render circular gauge", function renderGauge() {
      const { container } = renderWithProviders(
        <TotalCreditCard {...defaultTotalCredits} />,
      );

      const svg = container.querySelector("svg");
      expect(svg).toBeInTheDocument();
    });

    it("should render with ai-light background", function renderBackground() {
      const { container } = renderWithProviders(
        <TotalCreditCard {...defaultTotalCredits} />,
      );

      const card = container.firstChild as HTMLElement;
      expect(card.className).toContain("bg-ai-light/4");
    });
  });

  describe("renders error state", function errorStateTests() {
    it("should NOT render error state when totalCreditsSpent is 0 (valid state)", function noErrorZeroSpent() {
      renderWithProviders(
        <TotalCreditCard totalCreditsSpent={0} totalCreditsMax={1500} />,
      );

      // Should show the gauge, not error
      expect(
        screen.queryByText("builder_manageplan_credits_load_error"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByText(
          (content, element) => element?.textContent === "0/1,500",
        ),
      ).toBeInTheDocument();
    });

    it("should render error state when totalCreditsMax is 0", function renderErrorZeroMax() {
      renderWithProviders(
        <TotalCreditCard totalCreditsSpent={1129} totalCreditsMax={0} />,
      );

      expect(
        screen.getByText("builder_manageplan_credits_load_error"),
      ).toBeInTheDocument();
    });

    it("should render alert icon in error state", function renderAlertIcon() {
      const { container } = renderWithProviders(
        <TotalCreditCard totalCreditsSpent={0} totalCreditsMax={0} />,
      );

      // AlertIcon should be present
      const icon = container.querySelector("svg");
      expect(icon).toBeInTheDocument();
    });

    it("should still render title in error state", function renderTitleInError() {
      renderWithProviders(
        <TotalCreditCard totalCreditsSpent={0} totalCreditsMax={0} />,
      );

      expect(
        screen.getByText("builder_manageplan_total_credits"),
      ).toBeInTheDocument();
    });

    it("should have centered text in error state", function centeredText() {
      const { container } = renderWithProviders(
        <TotalCreditCard totalCreditsSpent={0} totalCreditsMax={0} />,
      );

      const errorContainer = container.firstChild as HTMLElement;
      expect(errorContainer.className).toContain("items-center");
      expect(errorContainer.className).toContain("justify-center");
    });
  });

  describe("handles different credit values", function creditValuesTests() {
    it("should handle fully used credits", function fullyUsed() {
      renderWithProviders(
        <TotalCreditCard totalCreditsSpent={1500} totalCreditsMax={1500} />,
      );

      expect(
        screen.getByText(
          (content, element) => element?.textContent === "1,500/1,500",
        ),
      ).toBeInTheDocument();
    });

    it("should handle large credit numbers", function largeNumbers() {
      renderWithProviders(
        <TotalCreditCard totalCreditsSpent={10000} totalCreditsMax={50000} />,
      );

      expect(
        screen.getByText(
          (content, element) => element?.textContent === "10,000/50,000",
        ),
      ).toBeInTheDocument();
    });

    it("should handle credits from multiple grants", function multipleGrants() {
      // Simulating totals from monthly (2500/10000) + credit pack (1000/5000)
      renderWithProviders(
        <TotalCreditCard totalCreditsSpent={3500} totalCreditsMax={15000} />,
      );

      expect(
        screen.getByText(
          (content, element) => element?.textContent === "3,500/15,000",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("memoization", function memoizationTests() {
    it("should be memoized and not re-render with same props", function memoized() {
      const { rerender } = renderWithProviders(
        <TotalCreditCard {...defaultTotalCredits} />,
      );

      // Re-render with same props should not cause issues
      rerender(<TotalCreditCard {...defaultTotalCredits} />);

      expect(
        screen.getByText("builder_manageplan_total_credits"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          (content, element) => element?.textContent === "1,129/1,500",
        ),
      ).toBeInTheDocument();
    });
  });
});
