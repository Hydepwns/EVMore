export interface Pagination {
  page: number;
  limit: number;
  total?: number;
  hasNext?: boolean;
  hasPrev?: boolean;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: Pagination;
}

export interface SortOptions {
  field: string;
  direction: 'asc' | 'desc';
}

export interface FilterOptions {
  [key: string]: any;
}

export interface QueryOptions {
  pagination?: Pagination;
  sort?: SortOptions;
  filters?: FilterOptions;
}

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: APIError;
  timestamp: Date;
}

export interface APIError {
  code: string;
  message: string;
  details?: Record<string, any>;
}

export interface TimeRange {
  start: Date;
  end: Date;
}

export interface RetryOptions {
  maxAttempts: number;
  initialDelay: number;
  maxDelay: number;
  backoffFactor: number;
  retryCondition?: (error: any) => boolean;
}

export interface CacheOptions {
  ttl: number; // Time to live in seconds
  maxSize?: number;
  namespace?: string;
}

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

export interface ConnectionOptions {
  timeout: number;
  retries: number;
  keepAlive?: boolean;
  headers?: Record<string, string>;
}

export interface Credential {
  type: 'api_key' | 'basic_auth' | 'bearer_token' | 'oauth';
  value: string;
  metadata?: Record<string, any>;
}

export interface SecretRef {
  provider: 'env' | 'aws' | 'vault' | '1password';
  key: string;
  version?: string;
}

export interface Feature {
  name: string;
  enabled: boolean;
  config?: Record<string, any>;
  rolloutPercentage?: number;
}

export interface Version {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  build?: string;
}

export interface BuildInfo {
  version: Version;
  commitHash: string;
  buildTime: Date;
  branch: string;
  environment: string;
}

// Utility types
export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

export type KeyOf<T> = keyof T;
export type ValueOf<T> = T[keyof T];

export type Flatten<T> = T extends (infer U)[] ? U : T;

export type NonEmptyArray<T> = [T, ...T[]];

export type Awaited<T> = T extends PromiseLike<infer U> ? U : T;

export type Constructor<T = {}> = new (...args: any[]) => T;

export type Mutable<T> = {
  -readonly [P in keyof T]: T[P];
};

export type ReadonlyDeep<T> = {
  readonly [P in keyof T]: T[P] extends object ? ReadonlyDeep<T[P]> : T[P];
};

// Common result patterns
export type Result<T, E = Error> = 
  | { success: true; data: T }
  | { success: false; error: E };

export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;

// Event patterns
export interface EventEmitter<T extends Record<string, any[]>> {
  on<K extends keyof T>(event: K, listener: (...args: T[K]) => void): void;
  off<K extends keyof T>(event: K, listener: (...args: T[K]) => void): void;
  emit<K extends keyof T>(event: K, ...args: T[K]): void;
}

// Disposable pattern
export interface Disposable {
  dispose(): void | Promise<void>;
}

// Factory pattern
export interface Factory<T> {
  create(...args: any[]): T;
}

// Observer pattern
export interface Observer<T> {
  next(value: T): void;
  error?(error: any): void;
  complete?(): void;
}

export interface Observable<T> {
  subscribe(observer: Observer<T>): Disposable;
}