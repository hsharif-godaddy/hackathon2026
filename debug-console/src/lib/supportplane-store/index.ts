import { DynamoStore } from '@/lib/supportplane-store/dynamo-store';
import type { SupportplaneStore } from '@/lib/supportplane-store/types';

let store: SupportplaneStore | null = null;

export function getStore(): SupportplaneStore {
  if (store) {
    return store;
  }

  store = new DynamoStore();
  return store;
}
