'use client';

import Link from 'next/link';
import GdTheGoIcon from '@ux/icon/gd-the-go';

import { useAuthContext } from '@/components/providers/AuthProvider';
import { useTranslations } from '@/hooks/useTranslations';
import { getRootDomain } from '@/utils/getRootDomain';
import { generateClickEID } from '@/utils/instrumentation';

interface GoDaddyLinkProps {
  location?: string;
  className?: string;
}

export default function GoDaddyLink({ location = 'unknown', className = '' }: GoDaddyLinkProps) {
  const t = useTranslations();
  const { isAuthenticated, isLoading } = useAuthContext();

  // Only show authenticated UI when auth is confirmed (not loading) and user is authenticated
  const showAuthenticatedUI = !isLoading && isAuthenticated;

  const godaddyUrl = 'https://www.godaddy.com';
  const getMyProductsUrl = () => `https://account.${getRootDomain() || 'godaddy.com'}/products`;
  const targetUrl = showAuthenticatedUI ? getMyProductsUrl() : godaddyUrl;

  return (
    <Link
      href={targetUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center ${className}`}
      data-eid={generateClickEID(`${location}.header.godaddy_logo`)}
      aria-label={t('builder_common_back_godaddy')}
    >
      <GdTheGoIcon className="w-4 h-4" />
    </Link>
  );
}
