import { type ConnectionFetchRoute, type ConnectionRpcHandlerResult } from '@deepseek-ai/dsh-client-connection';
/** Add one plugin-owned endpoint to the authenticated shared carrier. */
export declare function createBtwRpcRoute(handler: (method: string, payload: unknown, signal: AbortSignal) => Promise<ConnectionRpcHandlerResult>, endpoint?: string): ConnectionFetchRoute;
