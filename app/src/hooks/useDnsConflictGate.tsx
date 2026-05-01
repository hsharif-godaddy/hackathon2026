import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import DnsConflictModal from '@/components/layout/DnsConflictModal';
import { useDomainsQuery } from '@/hooks/useDomainsQuery';
import { DomainStatus, DomainType } from '@/lib/control-plane/types';
import { appFetch } from '@/lib/gasket-config';
import { logger } from '@/lib/request-context';
import type { Site } from '@/stores/useSiteStore';
import { findCustomerDomain, isAiroSubdomain, resolveSiteFqdn, sanitizeDomainInput } from '@/utils/domain';

interface ModalState {
  fqdn: string;
  isOpen: boolean;
  variant: 'conflict' | 'unverified';
}

interface GateResult {
  consent?: boolean;
  proceed: boolean;
  reason?: 'dismissed';
}

interface UseDnsConflictGateOptions {
  appId?: string | null;
  site?: Site | null;
}

export function useDnsConflictGate({ appId, site }: UseDnsConflictGateOptions) {
  const [modalState, setModalState] = useState<ModalState>({
    fqdn: '',
    isOpen: false,
    variant: 'conflict',
  });
  const pendingGatePromiseRef = useRef<Promise<GateResult> | null>(null);
  const pendingResultRef = useRef<((result: GateResult) => void) | null>(null);
  const { data: customerDomains = [] } = useDomainsQuery({ enabled: !!appId });

  const closeModal = useCallback((result: GateResult) => {
    setModalState((prev) => ({ ...prev, isOpen: false }));
    pendingResultRef.current?.(result);
    pendingResultRef.current = null;
  }, []);

  useEffect(() => () => {
    pendingResultRef.current?.({ proceed: false, reason: 'dismissed' });
    pendingResultRef.current = null;
  }, []);

  const runGate = useCallback(async (): Promise<GateResult> => {
    if (pendingGatePromiseRef.current) {
      return pendingGatePromiseRef.current;
    }

    const executeGate = async (): Promise<GateResult> => {
      if (!appId || !site) {
        return { proceed: true };
      }

      const activeCustomDomain = site.domains?.find(
        (domain) => domain.status === DomainStatus.ACTIVE && domain.domainType !== DomainType.PREFIX
      );
      if (!activeCustomDomain) {
        return { proceed: true };
      }

      const resolvedFqdn = resolveSiteFqdn(site);
      const fqdnUrl = resolvedFqdn || `https://${activeCustomDomain.fqdn}`;
      const domainOnly = sanitizeDomainInput(fqdnUrl);
      if (!domainOnly || isAiroSubdomain(fqdnUrl)) {
        return { proceed: true };
      }

      const customerDomainData = findCustomerDomain(domainOnly, customerDomains);
      if (!customerDomainData || customerDomainData.hasInternalNameservers !== true) {
        return { proceed: true };
      }

      try {
        const response = await appFetch(
          `/api/apps/${appId}/dns-check-conflict?fqdn=${encodeURIComponent(domainOnly)}`
        );
        if (!response.ok) {
          const details = await response.text().catch(() => '');
          logger.warn('publish.dns-conflict-gate.check-http-error', {
            appId,
            details,
            fqdn: domainOnly,
            status: response.status,
          });
          if (response.status >= 400 && response.status < 500) {
            return await new Promise<GateResult>((resolve) => {
              pendingResultRef.current = resolve;
              setModalState({
                fqdn: domainOnly,
                isOpen: true,
                variant: 'unverified',
              });
            });
          }
          return { proceed: true };
        }

        let payload: {
          currentIps: string[] | null;
          failedOpen: boolean;
          hasProductDNSConflict: boolean;
        };
        try {
          payload = await response.json();
        } catch (error) {
          if (error instanceof SyntaxError) {
            logger.error('publish.dns-conflict-gate.check-json-error', {
              appId,
              fqdn: domainOnly,
              error: error.message,
            });
          } else {
            logger.warn('publish.dns-conflict-gate.check-json-parse-failed', {
              appId,
              fqdn: domainOnly,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          return { proceed: true };
        }

        if (!payload.hasProductDNSConflict) {
          return { proceed: true };
        }

        return await new Promise<GateResult>((resolve) => {
          pendingResultRef.current = resolve;
          setModalState({
            fqdn: domainOnly,
            isOpen: true,
            variant: payload.failedOpen ? 'unverified' : 'conflict',
          });
        });
      } catch (error) {
        logger.warn('publish.dns-conflict-gate.check-failed', {
          appId,
          fqdn: domainOnly,
          error: error instanceof Error ? error.message : String(error),
        });
        return { proceed: true };
      }
    };

    const gatePromise = new Promise<GateResult>((resolve, reject) => {
      void executeGate().then(resolve, reject);
    });

    const finalizedGatePromise = gatePromise.finally(() => {
      if (pendingGatePromiseRef.current === finalizedGatePromise) {
        pendingGatePromiseRef.current = null;
      }
    });
    pendingGatePromiseRef.current = finalizedGatePromise;
    return finalizedGatePromise;
  }, [appId, customerDomains, site]);

  const modal = useMemo(() => {
    if (!modalState.isOpen) return null;
    return (
      <DnsConflictModal
        fqdn={modalState.fqdn}
        variant={modalState.variant}
        onClose={() => closeModal({ proceed: false, reason: 'dismissed' })}
        onConfirm={(consent) => closeModal({ proceed: true, consent })}
      />
    );
  }, [closeModal, modalState.fqdn, modalState.isOpen, modalState.variant]);

  return { modal, runGate };
}
