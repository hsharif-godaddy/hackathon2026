import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/request-context';
import { loadTranslations } from '@/lib/translations/load-translations';

/**
 * Public API route for fetching translation packages (No Authentication Required)
 * 
 * Thin wrapper around loadTranslations utility for client-side requests.
 * Server components should call loadTranslations directly (no HTTP overhead).
 * 
 * No authentication required - translations are public data.
 * 
 * @example
 * GET /api/i18n/package?packageName=@airo/app-builder
 * GET /api/i18n/package?packageName=@airo/app-builder&locale=es-ES
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const packageName = searchParams.get('packageName');
    const locale = searchParams.get('locale') || 'en-US';
    
    if (!packageName) {
      return NextResponse.json(
        { error: 'packageName query parameter is required' },
        { status: 400 }
      );
    }
    
    logger.info('translations.api.request', {
      packageName,
      locale,
      message: 'Translation package requested (client-side)'
    });
    
    const translations = await loadTranslations(locale, [packageName]);
    
    return NextResponse.json(translations, {
      headers: {
        'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=120',
      },
    });
  } catch (error) {
    logger.error('translations.api.error', {
      error,
      message: 'Failed to load translation package'
    });
    
    return NextResponse.json(
      { error: 'Failed to load translations' },
      { status: 500 }
    );
  }
}

