/**
 * Cross-platform storage abstraction for browser and Node.js environments
 */

interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Browser localStorage implementation
 */
class BrowserStorage implements Storage {
  private localStorage: any;

  constructor(localStorage: any) {
    this.localStorage = localStorage;
  }

  getItem(key: string): string | null {
    return this.localStorage.getItem(key);
  }

  setItem(key: string, value: string): void {
    this.localStorage.setItem(key, value);
  }

  removeItem(key: string): void {
    this.localStorage.removeItem(key);
  }
}

/**
 * In-memory storage implementation (fallback for Node.js)
 */
class MemoryStorage implements Storage {
  private storage = new Map<string, string>();

  getItem(key: string): string | null {
    return this.storage.get(key) || null;
  }

  setItem(key: string, value: string): void {
    this.storage.set(key, value);
  }

  removeItem(key: string): void {
    this.storage.delete(key);
  }
}

/**
 * Get appropriate storage implementation based on environment
 */
function getStorage(): Storage {
  // Check if we're in a browser environment with localStorage
  if (typeof globalThis !== 'undefined' && 
      (globalThis as any).localStorage && 
      typeof (globalThis as any).localStorage.getItem === 'function') {
    return new BrowserStorage((globalThis as any).localStorage);
  }
  
  // Fallback to in-memory storage for Node.js or other environments
  return new MemoryStorage();
}

// Export singleton instance
export const storage = getStorage();

/**
 * Type guard to check if localStorage is available
 */
export function hasLocalStorage(): boolean {
  return typeof globalThis !== 'undefined' && 
         (globalThis as any).localStorage && 
         typeof (globalThis as any).localStorage.getItem === 'function';
}