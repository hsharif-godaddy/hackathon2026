import { beforeEach, describe, expect, it } from 'vitest';

import { useUpfrontRebuildBuildQueueStore } from '@/stores/useUpfrontRebuildBuildQueueStore';

describe('useUpfrontRebuildBuildQueueStore', () => {
  beforeEach(() => {
    useUpfrontRebuildBuildQueueStore.setState({ queues: {} });
  });

  it('setPlan and shiftNext returns slugs after markProcessing', () => {
    const store = useUpfrontRebuildBuildQueueStore.getState();
    store.setPlan('app-1', ['homepage', 'about', 'contact'], ['about', 'contact']);
    expect(store.shiftNext('app-1')).toBeUndefined();
    store.markProcessing('app-1');
    expect(store.shiftNext('app-1')).toBe('about');
    expect(store.shiftNext('app-1')).toBe('contact');
    expect(store.shiftNext('app-1')).toBeUndefined();
  });

  it('setPlan is idempotent when entry already exists', () => {
    const store = useUpfrontRebuildBuildQueueStore.getState();
    store.setPlan('app-1', ['homepage', 'about'], ['about']);
    store.markDevelopComplete('app-1', 'homepage');
    store.setPlan('app-1', ['homepage', 'about', 'contact'], ['about', 'contact']);
    expect(useUpfrontRebuildBuildQueueStore.getState().queues['app-1'].planSlugs).toEqual([
      'homepage',
      'about',
    ]);
    expect(useUpfrontRebuildBuildQueueStore.getState().queues['app-1'].developCompletedSlugs).toEqual([
      'homepage',
    ]);
  });

  it('enqueue seeds homepage plus auto-build slugs', () => {
    const store = useUpfrontRebuildBuildQueueStore.getState();
    store.enqueue('app-1', ['about', 'contact']);
    expect(useUpfrontRebuildBuildQueueStore.getState().queues['app-1'].planSlugs).toEqual([
      'homepage',
      'about',
      'contact',
    ]);
    expect(useUpfrontRebuildBuildQueueStore.getState().queues['app-1'].slugs).toEqual([
      'about',
      'contact',
    ]);
  });

  it('setCurrentBuild tracks the active slug', () => {
    const store = useUpfrontRebuildBuildQueueStore.getState();
    store.setPlan('app-1', ['homepage', 'about'], ['about']);
    store.setCurrentBuild('app-1', 'about');
    expect(useUpfrontRebuildBuildQueueStore.getState().queues['app-1'].currentBuildSlug).toBe('about');
  });

  it('isPlanInProgress returns true until all plan slugs are complete', () => {
    const store = useUpfrontRebuildBuildQueueStore.getState();
    store.setPlan('app-1', ['homepage', 'about'], ['about']);
    expect(store.isPlanInProgress('app-1')).toBe(true);
    store.markDevelopComplete('app-1', 'homepage');
    expect(store.isPlanInProgress('app-1')).toBe(true);
    store.markDevelopComplete('app-1', 'about');
    expect(store.isPlanInProgress('app-1')).toBe(false);
  });

  it('markDevelopComplete tracks develop progress and clears currentBuildSlug', () => {
    const store = useUpfrontRebuildBuildQueueStore.getState();
    store.setPlan('app-1', ['homepage', 'about'], ['about']);
    store.setCurrentBuild('app-1', 'about');
    store.markDevelopComplete('app-1', 'about');
    expect(useUpfrontRebuildBuildQueueStore.getState().queues['app-1'].developCompletedSlugs).toEqual(['about']);
    expect(useUpfrontRebuildBuildQueueStore.getState().queues['app-1'].currentBuildSlug).toBeNull();
  });

  it('peekNext returns slug without mutating queue', () => {
    const store = useUpfrontRebuildBuildQueueStore.getState();
    store.setPlan('app-1', ['homepage', 'about', 'contact'], ['about', 'contact']);
    store.markProcessing('app-1');
    expect(store.peekNext('app-1')).toBe('about');
    expect(useUpfrontRebuildBuildQueueStore.getState().queues['app-1'].slugs).toEqual([
      'about',
      'contact',
    ]);
  });

  it('confirmDispatched removes slug from queue', () => {
    const store = useUpfrontRebuildBuildQueueStore.getState();
    store.setPlan('app-1', ['homepage', 'about', 'contact'], ['about', 'contact']);
    store.markProcessing('app-1');
    store.confirmDispatched('app-1', 'about');
    expect(useUpfrontRebuildBuildQueueStore.getState().queues['app-1'].slugs).toEqual(['contact']);
    expect(useUpfrontRebuildBuildQueueStore.getState().queues['app-1'].currentBuildSlug).toBe('about');
  });

  it('rollbackDispatch clears currentBuildSlug without removing queued slugs', () => {
    const store = useUpfrontRebuildBuildQueueStore.getState();
    store.setPlan('app-1', ['homepage', 'about'], ['about']);
    store.setCurrentBuild('app-1', 'about');
    store.rollbackDispatch('app-1');
    expect(useUpfrontRebuildBuildQueueStore.getState().queues['app-1'].currentBuildSlug).toBeNull();
    expect(useUpfrontRebuildBuildQueueStore.getState().queues['app-1'].slugs).toEqual(['about']);
  });

  it('shiftNext skips slugs already marked develop-complete', () => {
    const store = useUpfrontRebuildBuildQueueStore.getState();
    store.setPlan('app-1', ['homepage', 'about', 'contact'], ['about', 'contact']);
    store.markProcessing('app-1');
    store.markDevelopComplete('app-1', 'about');
    expect(store.shiftNext('app-1')).toBe('contact');
    expect(store.shiftNext('app-1')).toBeUndefined();
  });

  it('clear removes the queue for an app', () => {
    const store = useUpfrontRebuildBuildQueueStore.getState();
    store.setPlan('app-1', ['homepage', 'about'], ['about']);
    store.markProcessing('app-1');
    store.clear('app-1');
    expect(store.shiftNext('app-1')).toBeUndefined();
    expect(store.isPlanInProgress('app-1')).toBe(false);
  });
});
