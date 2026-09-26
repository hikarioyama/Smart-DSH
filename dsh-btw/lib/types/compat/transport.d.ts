import { type ConnectionFetchRoute, type ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection';
/** Add one plugin-owned endpoint to the authenticated shared carrier. */
export declare function createBtwRpcRoute(handler: ConnectionRpcHandler, endpoint?: string): ConnectionFetchRoute;
