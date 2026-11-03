import type { Probe } from '@oln/application';
import type { ObjectStorage } from './client';

export function storageProbe(storage: ObjectStorage): Probe {
  return {
    name: 'storage',
    check: () => storage.headBucket(),
  };
}
