import { clientRequestSchema, type ConnectionFetchRoute, type ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import { BTW_ASK_ENDPOINT, BTW_RPC_CHANNEL } from '../shared/protocol.js'

/** Add one plugin-owned endpoint to the authenticated shared carrier. */
export function createBtwRpcRoute(handler: ConnectionRpcHandler, endpoint = BTW_ASK_ENDPOINT): ConnectionFetchRoute {
  return {
    path: `${BTW_RPC_CHANNEL}/${endpoint}`,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })
      if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
        return new Response('content type must be application/json', { status: 415 })
      }
      let body: unknown
      try { body = await request.json() } catch { return new Response('body is not JSON', { status: 400 }) }
      const envelope = clientRequestSchema.safeParse(body)
      if (!envelope.success) return new Response('invalid client-request envelope', { status: 400 })
      const { rpcId, method, payload } = envelope.data
      if (method !== endpoint) {
        return Response.json({ type: 'server-response', rpcId, result: {
          ok: false, error: { code: 'bad-request', message: 'Unexpected BTW method.', details: {} },
        } })
      }
      const result = await handler(method, payload, request.signal)
      return Response.json({ type: 'server-response', rpcId, result })
    },
  }
}
