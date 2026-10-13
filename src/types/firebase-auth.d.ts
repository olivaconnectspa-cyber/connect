import 'firebase/auth';
import type { Persistence } from 'firebase/auth';

declare module 'firebase/auth' {
  /** Exported by Firebase's React Native entry point, selected by Metro. */
  export function getReactNativePersistence(storage: {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<unknown>;
    removeItem(key: string): Promise<unknown>;
  }): Persistence;
}
