/**
 * @vitest-environment jsdom
 */
import "@testing-library/jest-dom";

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent,render, screen } from "@testing-library/react";

import type { CreditGrant } from "@/types/credits";
import { GrantType, SubscriptionPlan } from "@/types/credits";
import ManagePlanLayout from "./ManagePlanLayout";

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@/hooks/useSubscriptionWithPolling", () => ({
  useSubscriptionWithPolling: () => ({
    subscription: {
      id: "sub-1",
      plan: "starter",
      renewsAt: "2027-01-14T00:00:00.000Z",
      downgradedPlan: null,
    },
    builderEntitlementId: "ent-123",
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("@/hooks/useEcommSubscriptionAutoRenewStatus", () => ({
  useEcommSubscriptionAutoRenewStatus: () => ({
    data: { autoRenew: true, paidThroughDate: "2027-01-14" },
    isLoading: false,
  }),
}));

vi.mock("@/hooks/useTranslations", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) => {
    if (values) return `${key}:${JSON.stringify(values)}`;
    return key;
  },
}));

vi.mock("@/utils/getRootDomain", () => ({
  getRootDomain: () => "godaddy.com",
}));

vi.mock("@/utils/instrumentation", () => ({
  generateClickEID: vi.fn(function (event: string) {
    return `${event}.click`;
  }),
}));

vi.mock("@/lib/logging", () => ({
  shipAnalyticsLog: vi.fn(),
  ClientLogBuffer: { add: vi.fn() },
}));

vi.mock("react-intl", () => ({
  FormattedMessage: ({ id }: { id: string }) => <span>{id}</span>,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock("framer-motion", () => ({
  motion: {
    span: ({
      children,
      ...props
    }: {
      children: React.ReactNode;
      className?: string;
    }) => <span {...props}>{children}</span>,
  },
}));

vi.mock("@ux/icon/chevron-down", () => ({
  default: () => <span data-testid="chevron-down" />,
}));

vi.mock("@ux/icon/chevron-up", () => ({
  default: () => <span data-testid="chevron-up" />,
}));

function createMockGrant(overrides: Partial<CreditGrant> = {}): CreditGrant {
  return {
    id: "grant-1",
    subscriptionId: "sub-1",
    type: GrantType.CreditPack,
    llmBudgetUserId: "user-1",
    llmBudgetId: "budget-1",
    creditsMax: 500,
    creditsSpent: 100,
    isAvailable: true,
    finalState: null,
    useBefore: "2027-12-01T00:00:00.000Z",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const defaultProps = {
  subscription: {
    id: "sub-1",
    customerId: "cust-1",
    plan: SubscriptionPlan.Starter,
    renewsAt: "2027-01-14T00:00:00.000Z",
    downgradedPlan: null,
  },
  planGrant: createMockGrant({
    id: "plan-grant",
    type: GrantType.PlanMonthly,
    creditsMax: 300,
    creditsSpent: 50,
  }),
  creditPacks: [] as CreditGrant[],
  activeGrantId: "plan-grant",
  locale: "en-US",
  openPaywall: vi.fn(),
  autoRenewStatus: { autoRenew: true, paidThroughDate: "2027-01-14" },
  onDowngradeClick: vi.fn(),
  builderEntitlementId: "ent-123",
  sites: [],
  isSitesLoading: false,
  currentPlan: SubscriptionPlan.Starter,
  publishedCount: 1,
  publishLimit: 1,
};

describe("ManagePlanLayout", () => {
  it("renders all four sections", () => {
    render(<ManagePlanLayout {...defaultProps} />);
    expect(
      screen.getByText("builder_manageplan_current_plan"),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("builder_manageplan_total_credits").length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText("builder_manageplan_monthly_plan_credits"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("builder_manageplan_creditpacks_title"),
    ).toBeInTheDocument();
  });

  it("excludes expired packs from total credits", () => {
    const activePack: CreditGrant = createMockGrant({
      id: "active-pack",
      creditsMax: 500,
      creditsSpent: 100,
      isAvailable: true,
      finalState: null,
    });
    const expiredPack: CreditGrant = createMockGrant({
      id: "expired-pack",
      creditsMax: 1000,
      creditsSpent: 1000,
      isAvailable: false,
      finalState: "expired",
    });

    const { container } = render(
      <ManagePlanLayout
        {...defaultProps}
        creditPacks={[activePack, expiredPack]}
      />,
    );

    // Total = plan (300) + active pack (500) = 800, excluding expired 1000
    // Left = 800 - 150 spent = 650
    expect(container.textContent).toContain("650");
    // Expired pack's 1000 max should NOT inflate the overview total to 1,800
    expect(container.textContent).not.toContain("1,800");
  });

  it("excludes used packs from total credits", () => {
    const usedPack: CreditGrant = createMockGrant({
      id: "used-pack",
      creditsMax: 500,
      creditsSpent: 500,
      isAvailable: false,
      finalState: "consumed",
    });

    const { container } = render(
      <ManagePlanLayout {...defaultProps} creditPacks={[usedPack]} />,
    );

    // Only plan grant contributes: max=300, spent=50
    // Used pack max (500) should not appear in the spent display as "550" total spent
    expect(container.textContent).toContain("50");
    expect(container.textContent).not.toContain("550");
  });

  it("renders My Projects button navigating to /apps", () => {
    render(<ManagePlanLayout {...defaultProps} />);
    const buttons: HTMLElement[] = screen.getAllByText("builder_manageplan_my_projects");
    fireEvent.click(buttons[0]);
    expect(mockPush).toHaveBeenCalledWith("/apps");
  });

  it("renders used/expired drawer toggle when packs exist", () => {
    const usedPack: CreditGrant = createMockGrant({
      id: "used-pack",
      isAvailable: false,
      finalState: "consumed",
    });

    render(
      <ManagePlanLayout {...defaultProps} creditPacks={[usedPack]} />,
    );
    expect(
      screen.getByText("builder_manageplan_show_used_expired"),
    ).toBeInTheDocument();
  });

  it("shows used/expired packs when drawer is toggled", () => {
    const activePack: CreditGrant = createMockGrant({
      id: "active-pack",
      isAvailable: true,
      finalState: null,
    });
    const usedPack: CreditGrant = createMockGrant({
      id: "used-pack",
      isAvailable: false,
      finalState: "consumed",
    });

    render(
      <ManagePlanLayout
        {...defaultProps}
        creditPacks={[activePack, usedPack]}
      />,
    );

    const toggle: HTMLElement = screen.getByText(
      "builder_manageplan_show_used_expired",
    );
    fireEvent.click(toggle);

    expect(
      screen.getByText("builder_manageplan_hide_used_expired"),
    ).toBeInTheDocument();
  });

  it("calls openPaywall when Buy Credits is clicked", () => {
    const openPaywall = vi.fn();
    render(<ManagePlanLayout {...defaultProps} openPaywall={openPaywall} />);

    const buyButtons: HTMLElement[] = screen.getAllByText(
      "builder_manageplan_buy_credits",
    );
    fireEvent.click(buyButtons[0]);
    expect(openPaywall).toHaveBeenCalled();
  });

  it("calls openPaywall for upgrade when Upgrade is clicked on Starter plan", () => {
    const openPaywall = vi.fn();
    render(
      <ManagePlanLayout
        {...defaultProps}
        openPaywall={openPaywall}
        currentPlan={SubscriptionPlan.Starter}
      />,
    );

    const upgradeButtons: HTMLElement[] = screen.getAllByText(
      "builder_manageplan_edit_plan",
    );
    fireEvent.click(upgradeButtons[0]);
    expect(openPaywall).toHaveBeenCalled();
  });

  it("calls openPaywall when Downgrade is clicked on Ultimate plan", () => {
    const openPaywall = vi.fn();
    render(
      <ManagePlanLayout
        {...defaultProps}
        currentPlan={SubscriptionPlan.Ultimate}
        subscription={{
          ...defaultProps.subscription,
          plan: SubscriptionPlan.Ultimate,
          downgradedPlan: null,
        }}
        openPaywall={openPaywall}
      />,
    );

    const downgradeButtons: HTMLElement[] = screen.getAllByText(
      "builder_manageplan_edit_plan",
    );
    fireEvent.click(downgradeButtons[0]);
    expect(openPaywall).toHaveBeenCalled();
  });

  it("does not render MonthlyPlanSection when planGrant is undefined", () => {
    render(<ManagePlanLayout {...defaultProps} planGrant={undefined} />);
    expect(
      screen.queryByText("builder_manageplan_monthly_plan_credits"),
    ).not.toBeInTheDocument();
  });

  it("renders empty credit packs state when no packs", () => {
    render(<ManagePlanLayout {...defaultProps} creditPacks={[]} />);
    expect(
      screen.getByText("builder_manageplan_creditpacks_empty_description"),
    ).toBeInTheDocument();
  });
});
