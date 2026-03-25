import "@testing-library/jest-dom";

import { describe, expect, it } from "vitest";

import { renderWithProviders } from "@/tests/test-utils";
import ManagePlanSkeleton from "./ManagePlanSkeleton";

describe("ManagePlanSkeleton", function managePlanSkeletonTests() {
  describe("renders correctly", function renderTests() {
    it("should render skeleton container with flex layout", function renderContainer() {
      const { container } = renderWithProviders(<ManagePlanSkeleton />);

      const skeletonContainer = container.firstChild as HTMLElement;
      expect(skeletonContainer.className).toContain("flex");
      expect(skeletonContainer.className).toContain("flex-col");
    });

    it("should render page title and description skeletons", function renderHeader() {
      const { container } = renderWithProviders(<ManagePlanSkeleton />);

      // Title skeleton (200px width, 32px height)
      const titleSkeleton = container.querySelector(
        '[style*="width: 200px"][style*="height: 32px"]',
      );
      expect(titleSkeleton).toBeInTheDocument();

      // Description skeleton (480px width)
      const descSkeleton = container.querySelector('[style*="width: 480px"]');
      expect(descSkeleton).toBeInTheDocument();
    });

    it("should render grid layout with start alignment on md", function renderGrid() {
      const { container } = renderWithProviders(<ManagePlanSkeleton />);

      const grid = container.querySelector('[class*="grid"]');
      expect(grid).toBeInTheDocument();
      expect(grid?.className).toContain("grid-cols-1");
      expect(grid?.className).toContain("md:items-start");
    });

    it("should render TotalCreditsCard skeleton with circular gauge", function renderTotalCreditsCard() {
      const { container } = renderWithProviders(<ManagePlanSkeleton />);

      // Check for the circular skeleton (120x120)
      const circularSkeleton = container.querySelector(
        '[style*="width: 120px"][style*="height: 120px"]',
      );
      expect(circularSkeleton).toBeInTheDocument();

      // Check for card styling
      const totalCard = container.querySelector('[class*="bg-ai-light"]');
      expect(totalCard).toBeInTheDocument();
    });

    it("should render PlanCreditsCard skeleton", function renderPlanCreditsCard() {
      const { container } = renderWithProviders(<ManagePlanSkeleton />);

      // Plan card has specific styling with rounded border
      const planCard = container.querySelector('[class*="rounded-xl"]');
      expect(planCard).toBeInTheDocument();

      // Should have progress bar skeleton (100% width)
      const progressSkeleton = container.querySelector(
        '[style*="width: 100%"]',
      );
      expect(progressSkeleton).toBeInTheDocument();
    });

    it("should render AddonCreditCard skeleton with credit rows", function renderAddonCard() {
      const { container } = renderWithProviders(<ManagePlanSkeleton />);

      // Should render 2 credit card row skeletons
      const creditCardSkeletons = container.querySelectorAll(
        '[class*="border-b"]',
      );
      expect(creditCardSkeletons.length).toBeGreaterThanOrEqual(2);
    });

    it("should render action button skeletons", function renderActionButtons() {
      const { container } = renderWithProviders(<ManagePlanSkeleton />);

      // Check for button-sized skeletons (100px and 120px width)
      const buttonSkeletons = container.querySelectorAll(
        '[style*="height: 32px"]',
      );
      expect(buttonSkeletons.length).toBeGreaterThanOrEqual(2);
    });

    it("should have proper responsive classes for grid", function responsiveClasses() {
      const { container } = renderWithProviders(<ManagePlanSkeleton />);

      const grid = container.querySelector('[class*="md:grid-cols-12"]');
      expect(grid).toBeInTheDocument();
    });

    it("should have proper responsive classes for right column", function rightColumnResponsive() {
      const { container } = renderWithProviders(<ManagePlanSkeleton />);

      const rightColumn = container.querySelector('[class*="md:col-span-9"]');
      expect(rightColumn).toBeInTheDocument();
    });
  });
});
