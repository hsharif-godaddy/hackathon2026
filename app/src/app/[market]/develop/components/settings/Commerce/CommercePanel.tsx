'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Button from '@ux/button';
import ProductsIcon from '@ux/icon/products';
import ReceiptIcon from '@ux/icon/receipt';
import TransactionsIcon from '@ux/icon/transactions';
import Text from '@ux/text';
import TextLockup from '@ux/text-lockup';

import { CommerceBinding, useCommerceBinding } from '@/hooks/useCommerceBinding';
import { getRootDomain } from '@/utils/getRootDomain';
import { CommerceSettingDetail } from './CommerceSettingDetail';
import {
  CommerceHomeLinkCard,
  DebugState,
  ItemRow,
  LoadingSpinner,
  NoticePlaceholder,
  SectionHeader,
} from './Components';
import { normalizeSettingPath, normalizeSurfaceSections } from './Normalizers';
import { fetchSettingsApi } from './SettingsApiClient';
import type { ApiSettingsSurface, CommercePanelTab, SettingsItem, SurfaceSection } from './Types';

// PROTOTYPE: Commerce Settings API renderer inside Airo Settings.
// Uses the real Develop settings pane as the review surface. Delete or absorb after the IA decision is made.

const panelTabs: Array<{ id: CommercePanelTab; text: string }> = [
  { id: 'dashboard', text: 'Dashboard' },
  { id: 'settings', text: 'Settings' },
];

function initialQueryParam(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback;
  return new URLSearchParams(window.location.search).get(name) ?? fallback;
}

function updateQueryParam(name: string, value: string) {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  if (value) {
    url.searchParams.set(name, value);
  } else {
    url.searchParams.delete(name);
  }

  window.history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

function panelTabFromQuery(value: string): CommercePanelTab {
  return panelTabs.some((tab) => tab.id === value) ? (value as CommercePanelTab) : 'dashboard';
}

function SettingsTabContent({
  sections,
  isLoading,
  hasStoreId,
  error,
  onSelectItem,
}: {
  sections: SurfaceSection[];
  isLoading: boolean;
  hasStoreId: boolean;
  error?: Error | null;
  onSelectItem: (item: SettingsItem) => void;
}) {
  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (error) {
    return (
      <NoticePlaceholder
        label={`Commerce settings unavailable: ${error.message}`}
        title="Commerce settings unavailable"
        description={error.message}
      />
    );
  }

  if (sections.length === 0) {
    return (
      <NoticePlaceholder
        label="No Commerce settings returned"
        title="No Commerce settings returned"
        description="The Settings API returned an empty settings surface for this store."
      />
    );
  }

  return (
    <div className="flex flex-col gap-2.5 @container">
      {sections.map((section) => (
        <div key={section.id} className="flex flex-col gap-1.5 p-1">
          <SectionHeader title={section.title} description={section.description} />
          <div className="flex flex-col gap-1">
            {section.items.map((item) => (
              <ItemRow key={item.id} item={item} onSelect={onSelectItem} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function DashboardTabContent({ storeId }: { storeId: string }) {
  const rootDomain = getRootDomain() ?? 'godaddy.com';
  const url = (path) => `https://spa.commerce.${rootDomain}/${path}?storeId=${storeId}`;

  return (
    <div className="p-1">
      <CommerceHomeLinkCard
        icon={<ReceiptIcon />}
        title={'Manage Orders'}
        content={'Manage orders, fulfillment, pickups and delivery'}
        to={url('orders')}
      />
      <CommerceHomeLinkCard
        icon={<TransactionsIcon />}
        title={'Manage Transactions'}
        content={'Manage transactions, refunds, and disputes'}
        to={url('transactions')}
      />
      <CommerceHomeLinkCard
        icon={<ProductsIcon />}
        title={'Manage Catalog'}
        content={'Manage products, categories, and fees/discounts'}
        to={url('products')}
      />
    </div>
  );
}

function CommercePanelTabs({
  activeTab,
  onChange,
}: {
  activeTab: CommercePanelTab;
  onChange: (tab: CommercePanelTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Commerce panel section"
      className="inline-flex items-center gap-0.5 rounded-lg bg-intents-ux-box-backgroundColor p-0.5"
    >
      {panelTabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <Button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            aria-controls={`commerce-panel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            design={isActive ? 'primary' : 'tertiary'}
            size="sm"
            text={tab.text}
            className="rounded-lg!"
            onClick={() => onChange(tab.id)}
          />
        );
      })}
    </div>
  );
}

export function CommercePanel({ appId }: { appId: string }) {
  const [activeTab, setActiveTabState] = useState<CommercePanelTab>(() =>
    panelTabFromQuery(initialQueryParam('commerceTab', 'dashboard'))
  );
  const [commercePath, setCommercePathState] = useState(() =>
    initialQueryParam('commercePath', '')
  );
  const [lastAction, setLastAction] = useState('Opened Commerce dashboard');

  const commerceBindingQuery = useCommerceBinding(appId);
  const commerceBinding: CommerceBinding | null = commerceBindingQuery.data?.binding ?? null;
  const resolvedStoreId = commerceBinding?.storeId ?? null;

  const surfaceQuery = useQuery({
    queryKey: ['commerce-settings-surface', resolvedStoreId],
    queryFn: ({ signal }) =>
      fetchSettingsApi<ApiSettingsSurface>(resolvedStoreId as string, 'surface', signal),
    enabled: Boolean(resolvedStoreId),
    staleTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const surfaceSections = useMemo(
    () => normalizeSurfaceSections(surfaceQuery.data),
    [surfaceQuery.data]
  );

  useEffect(() => {
    const onPopState = () => {
      setActiveTabState(panelTabFromQuery(initialQueryParam('commerceTab', 'dashboard')));
      setCommercePathState(initialQueryParam('commercePath', ''));
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const setActiveTab = useCallback((nextTab: CommercePanelTab) => {
    setActiveTabState(nextTab);
    updateQueryParam('commerceTab', nextTab);
    setLastAction(`Opened ${nextTab}`);
  }, []);

  const setCommercePath = useCallback((nextPath: string) => {
    setCommercePathState(nextPath);
    updateQueryParam('commercePath', nextPath);
  }, []);

  const onPanelTabChange = useCallback(
    (nextTab: CommercePanelTab) => {
      setActiveTab(nextTab);
      setCommercePath('');
      if (nextTab === 'settings' && !resolvedStoreId && !commerceBindingQuery.isFetching) {
        void commerceBindingQuery.refetch();
      }
    },
    [commerceBindingQuery, resolvedStoreId, setActiveTab, setCommercePath]
  );

  const onSelect = useCallback(
    (item: SettingsItem) => {
      if (item.renderer === 'external-link') {
        if (!item.href) return;
        const url = new URL(item.href);
        const urlsp = new URLSearchParams(url.search);

        if (!urlsp.get('storeId') && resolvedStoreId) {
          urlsp.set('storeId', resolvedStoreId);
        }
        url.search = urlsp.toString();

        setLastAction(`Would open external link: ${url.toString()}`);
        window.open(url, '_blank');
        return;
      }

      if (!item.path) return;
      const nextPath = normalizeSettingPath(item.path);
      setActiveTab('settings');
      setCommercePath(nextPath);
      setLastAction(`Selected ${item.title}`);
    },
    [setActiveTab, setCommercePath, resolvedStoreId]
  );

  const baseDebugState = useMemo(
    () => ({
      appId,
      storeId: resolvedStoreId ?? null,
      storeIdSource: commerceBinding?.storeId ? commerceBinding.source : null,
      commerceBindingError:
        commerceBindingQuery.error instanceof Error ? commerceBindingQuery.error.message : null,
      surfaceError: surfaceQuery.error instanceof Error ? surfaceQuery.error.message : null,
      activeSettingsSection: 'commerce',
      activeTab,
      commercePath: commercePath || null,
      renderer: activeTab === 'settings' ? 'settings-surface' : 'dashboard',
      source: 'commerce',
      revision: surfaceQuery.data?.revision ?? null,
      returnedSections: surfaceSections.length,
      lastAction,
    }),
    [
      activeTab,
      appId,
      commercePath,
      lastAction,
      resolvedStoreId,
      commerceBinding?.source,
      commerceBinding?.storeId,
      commerceBindingQuery.error,
      surfaceQuery.error,
      surfaceQuery.data?.revision,
      surfaceSections.length,
    ]
  );

  if (commerceBindingQuery.isLoading) {
    return <LoadingSpinner />;
  }

  if (!resolvedStoreId) {
    return (
      <div className="flex flex-col gap-1">
        <TextLockup title={'Commerce'}>
          <Text.p>
            {
              'Connecting your app to commerce will link this project with a new or existing GoDaddy Commerce business.'
            }
          </Text.p>
          <Text.p>
            {
              'GoDaddy Commerce is a powerful toolkit to sell online, with catalog management, order fulfillment, and transaction handling built in.'
            }
          </Text.p>
          <Text.p>
            {
              "Ready to get started? Just ask Airo to connect your business, and you'll be set up in no time!"
            }
          </Text.p>
        </TextLockup>
      </div>
    );
  }

  if (commercePath) {
    return (
      <>
        <CommerceSettingDetail
          storeId={resolvedStoreId}
          commercePath={commercePath}
          onCommercePathChange={setCommercePath}
          onLastAction={setLastAction}
          onRefetchSurface={surfaceQuery.refetch}
          baseDebugState={baseDebugState}
        />
        {/* <DebugState state={baseDebugState} /> */}
      </>
    );
  }

  return (
    <div className="@container flex flex-col gap-2.5">
      <div className="flex items-center">
        <CommercePanelTabs activeTab={activeTab} onChange={onPanelTabChange} />
      </div>
      <div role="tabpanel" id={`commerce-panel-${activeTab}`}>
        {activeTab === 'settings' ? (
          <SettingsTabContent
            sections={surfaceSections}
            isLoading={commerceBindingQuery.isLoading || surfaceQuery.isLoading}
            hasStoreId={Boolean(resolvedStoreId)}
            error={surfaceQuery.error instanceof Error ? surfaceQuery.error : null}
            onSelectItem={onSelect}
          />
        ) : (
          <DashboardTabContent storeId={resolvedStoreId} />
        )}
      </div>
      {/* <DebugState state={baseDebugState} /> */}
    </div>
  );
}
