import { NextRequest, NextResponse } from 'next/server';

import { logger } from '@/lib/request-context';
import { getApiBaseUrl } from '@/utils/getServerRootDomain';

export const dynamic = 'force-dynamic';

const PRICING_QUERY = `
  query {
    newOffers(
      offerGroup: {
        items: [
          {
            plan: "starter"
            term: { termType: "YEAR", numberOfTerms: 1 }
            includeTaxes: false
            tags: ["airo-builder"]
          }
        ]
      }
    ) {
      offers {
        id
        productKey
        catalogInstanceKey
        currency
        marketId
        term {
          count
          unit
        }
        price {
          numeric {
            listing {
              perTerm {
                full
                discounted
                renewal
                renewalDiscounted
              }
            }
          }
        }
      }
    }
  }
`;

// Cookies that Offer Graph API needs for market/pricing determination
const ALLOWED_COOKIES = [
  'market',
  'currency',
  'plid',
  'info_cust_idp',
  'info_idp',
  'login_info_idp'
];

function filterCookies(cookieHeader: string): string {
  if (!cookieHeader) return '';

  const cookies = cookieHeader.split(';').map(c => c.trim());
  const filtered = cookies.filter(cookie => {
    const cookieName = cookie.split('=')[0];
    return ALLOWED_COOKIES.includes(cookieName);
  });

  return filtered.join('; ');
}

export async function GET(request: NextRequest) {
  try {
    const offerGraphApiUrl = `${getApiBaseUrl(request, 'og.api')}/graphql`;

    // Get cookies and filter to only those needed by Offer Graph API
    const incomingCookies = request.headers.get('cookie') || '';
    const filteredCookies = filterCookies(incomingCookies);

    logger.info('pricing.offers.fetch.start', {
      url: offerGraphApiUrl
    });

    // Forward only whitelisted cookies to Offer Graph API
    const response = await fetch(offerGraphApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(filteredCookies && { 'Cookie': filteredCookies }),
      },
      body: JSON.stringify({
        query: PRICING_QUERY,
      }),
    });

    if (!response.ok) {
      logger.error('pricing.offers.fetch.failed', {
        status: response.status,
        statusText: response.statusText,
      });
      throw new Error(`Offer Graph API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    if (data.errors) {
      logger.error('pricing.offers.graphql.errors', { errors: data.errors });
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }

    logger.info('pricing.offers.fetch.success', {
      offerCount: data.data?.newOffers?.offers?.length || 0,
      marketId: data.data?.newOffers?.offers?.[0]?.marketId,
      currency: data.data?.newOffers?.offers?.[0]?.currency,
    });

    return NextResponse.json({
      success: true,
      data: data.data,
    });
  } catch (error) {
    logger.error('pricing.offers.fetch.error', { error: error as Error });
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch pricing offers',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
