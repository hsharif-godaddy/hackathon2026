const COMMERCE_SOURCE_SELECTOR = '[data-dev-source-origin="commerce"]';

export function findCommerceManagedContentRoot(element: HTMLElement | null): HTMLElement | null {
  return element?.closest(COMMERCE_SOURCE_SELECTOR) as HTMLElement | null;
}

export function isCommerceManagedContent(element: HTMLElement | null): boolean {
  return findCommerceManagedContentRoot(element) !== null;
}
