/**
 * Type extensions for Node.js internal APIs
 * These are not officially documented but commonly used for monitoring
 */

declare global {
  namespace NodeJS {
    interface Process {
      /**
       * Get active handles count (internal API)
       * This is used for resource monitoring but may not be available in all Node.js versions
       */
      _getActiveHandles?(): any[];
      
      /**
       * Get active requests count (internal API)
       * This is used for resource monitoring but may not be available in all Node.js versions
       */
      _getActiveRequests?(): any[];
      
      /**
       * Thread ID (available in worker threads)
       * May not be available in main thread
       */
      threadId?: number;
    }
  }
}

/**
 * Safely get active handles count
 */
export function getActiveHandlesCount(): number {
  try {
    return process._getActiveHandles?.()?.length || 0;
  } catch {
    return 0;
  }
}

/**
 * Safely get active requests count
 */
export function getActiveRequestsCount(): number {
  try {
    return process._getActiveRequests?.()?.length || 0;
  } catch {
    return 0;
  }
}

/**
 * Safely get thread ID (defaults to 1 for main thread)
 */
export function getThreadId(): number {
  return process.threadId || 1;
}

export {};