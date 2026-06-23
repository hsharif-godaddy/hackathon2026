/**
 * Unit tests for IDX Broker type utilities
 *
 * Tests cover parseIDXListings helper function to ensure proper data unwrapping
 * and null filtering from the IDX Broker API response.
 */

import { describe, it, expect } from 'vitest';
import { parseIDXListings, type IDXFeaturedResponse, type IDXListing } from '../types';

describe('parseIDXListings', () => {
  it('should unwrap data object and return array of listings', () => {
    const response: IDXFeaturedResponse = {
      total: 2,
      first: 'https://api.idxbroker.com/clients/featured?offset=0',
      last: 'https://api.idxbroker.com/clients/featured?offset=0',
      next: null,
      previous: null,
      data: {
        'a000!%M1422715': {
          listingID: 'M1422715',
          address: '33 ARVIDA PW',
          streetName: 'ARVIDA PW',
          streetNumber: '33',
          cityName: 'Coral Gables',
          countyName: 'Miami-Dade',
          state: 'FLORIDA',
          zipcode: '33156',
          listingPrice: '$14,500,000',
          bedrooms: '8',
          totalBaths: '8',
          sqFt: '13,086',
          acres: '0',
          remarksConcat: 'Beautiful home',
          propStatus: 'A',
          latitude: '25.689',
          longitude: '-80.250',
          featured: 'y',
          image: { totalCount: '0' },
          detailsURL: 'a000/M1422715',
          fullDetailsURL: 'https://example.com/details/M1422715',
          idxID: 'a000',
          idxPropType: 'Single Family',
          idxStatus: 'active',
        } as IDXListing,
        'a000!%M1364182': {
          listingID: 'M1364182',
          address: '265 N HIBISCUS DR',
          streetName: 'HIBISCUS DR',
          streetNumber: '265',
          cityName: 'Miami Beach',
          countyName: 'Miami-Dade',
          state: 'FLORIDA',
          zipcode: '33139',
          listingPrice: '$7,500,000',
          bedrooms: '5',
          totalBaths: '5',
          sqFt: '5,346',
          acres: '0',
          remarksConcat: 'Waterfront property',
          propStatus: 'A',
          latitude: '25.783',
          longitude: '-80.161',
          featured: 'y',
          image: { totalCount: '0' },
          detailsURL: 'a000/M1364182',
          fullDetailsURL: 'https://example.com/details/M1364182',
          idxID: 'a000',
          idxPropType: 'Single Family',
          idxStatus: 'active',
        } as IDXListing,
      },
    };

    const listings = parseIDXListings(response);

    expect(listings).toHaveLength(2);
    expect(listings[0].listingID).toBe('M1422715');
    expect(listings[1].listingID).toBe('M1364182');
  });

  it('should filter out null values from data object', () => {
    const response: IDXFeaturedResponse = {
      total: 1,
      first: 'https://api.idxbroker.com/clients/featured?offset=0',
      last: 'https://api.idxbroker.com/clients/featured?offset=0',
      next: null,
      previous: null,
      data: {
        'a000!%M1422715': {
          listingID: 'M1422715',
          address: '33 ARVIDA PW',
          streetName: 'ARVIDA PW',
          streetNumber: '33',
          cityName: 'Coral Gables',
          countyName: 'Miami-Dade',
          state: 'FLORIDA',
          zipcode: '33156',
          listingPrice: '$14,500,000',
          bedrooms: '8',
          totalBaths: '8',
          sqFt: '13,086',
          acres: '0',
          remarksConcat: 'Beautiful home',
          propStatus: 'A',
          latitude: '25.689',
          longitude: '-80.250',
          featured: 'y',
          image: { totalCount: '0' },
          detailsURL: 'a000/M1422715',
          fullDetailsURL: 'https://example.com/details/M1422715',
          idxID: 'a000',
          idxPropType: 'Single Family',
          idxStatus: 'active',
        } as IDXListing,
        'null-key': null as any,
      },
    };

    const listings = parseIDXListings(response);

    expect(listings).toHaveLength(1);
    expect(listings[0].listingID).toBe('M1422715');
  });

  it('should return empty array when data object is empty', () => {
    const response: IDXFeaturedResponse = {
      total: 0,
      first: 'https://api.idxbroker.com/clients/featured?offset=0',
      last: 'https://api.idxbroker.com/clients/featured?offset=0',
      next: null,
      previous: null,
      data: {},
    };

    const listings = parseIDXListings(response);

    expect(listings).toHaveLength(0);
    expect(listings).toEqual([]);
  });
});
