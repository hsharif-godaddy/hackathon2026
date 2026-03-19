/**
 * Ensures PropTypes is available on the global window object.
 * This function is idempotent - it will only load PropTypes once.
 *
 * @returns Promise that resolves when PropTypes is available on window
 */
let propTypesPromise: Promise<void> | null = null;

export async function ensurePropTypes(): Promise<void> {
  if (typeof window === 'undefined') {return;}
  if ((window as any).PropTypes) {return;}
  if (propTypesPromise) {return propTypesPromise;}
  
  propTypesPromise = import('prop-types').then(PropTypes => {
    (window as any).PropTypes = PropTypes.default;
    propTypesPromise = null;
  });
  
  return propTypesPromise;
}