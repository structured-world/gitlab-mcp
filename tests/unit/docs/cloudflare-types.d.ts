/**
 * Minimal Cloudflare Workers type stubs for Jest test environment.
 * These types allow importing the report-bug module without
 * requiring @cloudflare/workers-types in the test tsconfig.
 */

declare interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

declare type PagesFunction<Env = unknown> = (
  context: EventContext<Env, string, unknown>
) => Promise<Response> | Response;

declare interface EventContext<Env = unknown, P extends string = string, Data = unknown> {
  request: Request;
  env: Env;
  params: Record<P, string>;
  data: Data;
  next: () => Promise<Response>;
  waitUntil: (promise: Promise<unknown>) => void;
  passThroughOnException: () => void;
}
