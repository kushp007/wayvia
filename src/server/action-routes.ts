/**
 * Authenticated server actions and the tools they use to reach app records
 * and integrations.
 *
 * Trust model — read before adding an action:
 *
 * This worker is the only authorization boundary. `resolveAuth` establishes
 * *who* is calling; everything after it runs with that identity and no further
 * checks. The tools handed to an action (`createActionTools`) reach the record
 * room with `X-App-Action: 'true'`, which turns **per-record RBAC off**: the
 * `userId` they carry is the identity they act *as*, not a permission the room
 * enforces. `tools.query`/`tools.update`/`tools.remove`/`tools.deleteWhere`
 * will therefore read and write any collection, including other users' rows.
 *
 * So an action that takes a record id from `params` and passes it to `tools.*`
 * has authorized nothing. Check ownership yourself — load the record and
 * compare it against `userId` before writing (`chat-history.ts`'s `getChat` is
 * the SDK's worked example) — or the action is an open door with a login page
 * in front of it.
 *
 * `tools.deleteWhere(collection, where, limit?)` is the batch delete behind
 * cascades: it removes at most `limit` matching records (default 100, max 500)
 * and answers `{ deleted }`, so a drain loop repeats the same call until
 * `deleted` is below the limit. `where` must be non-empty and every key must
 * name a real field, so it can never truncate a collection by accident — but
 * with RBAC off it does not care who owns the rows, so scope `where` to the
 * caller yourself.
 */

import type { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import {
  apiWorkerFetch,
  lookupOwn,
  normalizeApiError,
  splitIntegrationEndpoint,
} from 'deepspace/worker'
import type { ActionResult, ActionTools, VerifyResult } from 'deepspace/worker'
import { actions } from '../actions/index.js'
import { travelActions } from '../actions/travel.js'
import { applyCommonsCover } from '../actions/collaboration.js'
import { findCommonsCover } from '../actions/commons-cover.js'
import { TRIPS, type TripRecord } from '../lib/trips.js'
import { integrations } from '../integrations.js'
import type { AppContext, Env } from '../../worker.js'

type ResolveAuth = (req: Request, env: Env) => Promise<VerifyResult | null>
export const ACTION_ROOM_URL = 'https://internal/internal/wayvia-actions'
const activeCoverLookups = new Set<string>()
const coverRate = new Map<string, { remaining: number; resets: number }>()

export function registerActionRoutes(app: Hono<AppContext>, resolveAuth: ResolveAuth): void {
  app.post('/api/actions/:name', bodyLimit({ maxSize: 16_384 }), async (c) => {
    const auth = await resolveAuth(c.req.raw, c.env)
    if (!auth) return c.json({ error: 'Unauthorized' }, 401)
    // `resolveAuth` may accept a cookie session, which carries no bearer token
    // — and `VerifyResult` exposes the claims, not the raw JWT. Actions need
    // the token itself (user-billed integrations forward it), so a call
    // without one is refused as an auth failure, next to the check above,
    // rather than crashing on a missing header further down.
    const authHeader = c.req.header('Authorization') ?? ''
    const callerJwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!callerJwt) return c.json({ error: 'Unauthorized' }, 401)
    // Who called: actions run RBAC-off and can bill the owner, and the
    // platform's request log carries no user — this line is the attribution.
    // The name is a decoded path segment, so it is quoted, never interpolated raw.
    console.info(`[action] ${JSON.stringify(c.req.param('name'))} caller=${auth.userId}`)
    const name = c.req.param('name')
    // Own keys only: `actions[name]` also finds `constructor` (Object), which
    // returns the handler argument, env secrets included, as the response.
    const action = lookupOwn(actions, name)
    if (!action && name !== 'cover-lookup') return c.json({ error: 'Action not found' }, 404)
    const params = await c.req.json<unknown>().catch(() => null)
    if (!params || typeof params !== 'object' || Array.isArray(params)) return c.json({ error: 'Invalid action input' }, 400)
    const room = c.env.RECORD_ROOMS.get(c.env.RECORD_ROOMS.idFromName(`app:${c.env.DEEPSPACE_APP_ID}`))
    const envelope = { name, params: params as Record<string, unknown>, userId: auth.userId, callerJwt }
    // Read-only provider work runs outside the serialized trip mutation queue.
    if (lookupOwn(travelActions, name)) return dispatchRoomAction(envelope, c.env, request => room.fetch(request))
    const send = (input: ActionEnvelope) => room.fetch(new Request(ACTION_ROOM_URL, {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
    }))
    const cover = async (id: unknown, automatic: boolean) => {
      const tools = createActionTools(c.env, auth.userId, callerJwt, request => room.fetch(request))
      if (typeof id !== 'string' || id.length < 1 || id.length > 128) {
        return Response.json({ success: false, error: 'This trip is unavailable.' })
      }
      const result = await tools.get<TripRecord>(TRIPS, id)
      if (!result.success || result.data.record.createdBy !== auth.userId) {
        return Response.json({ success: false, error: 'This trip is unavailable.' })
      }
      const { destination, image } = result.data.record.data
      if (automatic && image) return Response.json({ success: true, data: { updated: false } })
      const key = c.env.DEEPSPACE_APP_ID + ':' + id
      const reply = (status: string) => Response.json({ success: true, data: { status } })
      if (activeCoverLookups.has(key)) return reply('pending')
      if (activeCoverLookups.size >= 32) return reply('busy')
      const now = Date.now()
      const rateKey = c.env.DEEPSPACE_APP_ID + ':' + auth.userId + ':' + (automatic ? 'auto' : 'manual')
      let rate = coverRate.get(rateKey)
      if (!rate || rate.resets <= now) {
        rate = { remaining: automatic ? 8 : 5, resets: now + 60_000 }
        coverRate.delete(rateKey)
        coverRate.set(rateKey, rate)
        if (coverRate.size > 512) coverRate.delete(coverRate.keys().next().value!)
      }
      if (rate.remaining <= 0) {
        return Response.json({ success: true, data: { status: 'limited', retryAfter: Math.ceil((rate.resets - now) / 1000) } })
      }
      rate.remaining--
      activeCoverLookups.add(key)
      try {
        const match = await findCommonsCover(destination)
        if (match.status !== 'found') return reply(match.status)
        return await send({ ...envelope, name: 'cover-apply', params: { recordId: id, destination, previousImage: image ?? '', cover: match.cover } })
      } finally {
        activeCoverLookups.delete(key)
      }
    }
    if (name === 'cover-lookup') return cover(envelope.params.recordId, false)
    const response = await send(envelope)
    if (name === 'trip-create' && response.ok) {
      c.executionCtx.waitUntil(response.clone().json<ActionResult<{ recordId: string }>>()
        .then(result => result.success ? cover(result.data.recordId, true) : undefined)
        .catch(() => undefined))
    }
    return response
  })
}

type ActionEnvelope = { name: string; userId: string; callerJwt: string; params: Record<string, unknown> }
type RecordFetch = (request: Request) => Promise<Response>

export async function dispatchRoomAction(envelope: ActionEnvelope, env: Env, fetchRecord: RecordFetch) {
  const { name, params, userId, callerJwt } = envelope
  const action = name === 'cover-apply' ? applyCommonsCover : lookupOwn(actions, name)
  if (!action) return Response.json({ error: 'Action not found' }, { status: 404 })
  const result = await action({ userId, params, tools: createActionTools(env, userId, callerJwt, fetchRecord), env, callerJwt })
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
}

function createActionTools(env: Env, userId: string, callerJwt: string, fetchRecord: RecordFetch): ActionTools {

  // The DO returns ActionResult<unknown>; callers below supply the precise
  // operation result type fixed by the SDK tools-api wire contract.
  async function execTool<TData>(
    tool: string,
    params: Record<string, unknown>,
  ): Promise<ActionResult<TData>> {
    const res = await fetchRecord(
      new Request('https://internal/api/tools/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
          'X-App-Action': 'true',
        },
        body: JSON.stringify({ tool, params }),
      }),
    )
    return res.json() as Promise<ActionResult<TData>>
  }

  async function callIntegration<T>(endpoint: string, data?: unknown): Promise<ActionResult<T>> {
    // "name/endpoint", both plain identifiers: anything else could reach
    // another api-worker route carrying the owner's token.
    const target = splitIntegrationEndpoint(endpoint)
    if (!target) {
      return {
        success: false,
        code: 'invalid_integration_endpoint',
        error: `Integration endpoint ${JSON.stringify(endpoint)} must be "<integration>/<endpoint>"`,
      }
    }
    const integrationName = target.name
    const billingMode = lookupOwn(integrations, integrationName)?.billing ?? 'developer'

    // The api-worker bills the JWT subject: owner for developer mode, caller
    // for user mode. It does not accept a client-supplied billing override.
    const jwt = billingMode === 'developer' ? env.APP_OWNER_JWT : callerJwt
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    }

    // Composio files connections per app, so identify this app as the
    // /api/integrations proxy does; otherwise an action looks for the user's
    // connection in a different namespace. Pre-first-deploy there is no token:
    // omit both and let the api-worker fail closed.
    if (env.APP_IDENTITY_TOKEN) {
      headers['x-app-identity-token'] = env.APP_IDENTITY_TOKEN
      headers['x-app-id'] = env.DEEPSPACE_APP_ID
    }

    const res = await apiWorkerFetch(env, target.path, {
      method: 'POST',
      headers,
      body: JSON.stringify(data ?? {}),
      signal: AbortSignal.timeout(35_000),
    })
    const payload = (await res.json()) as Record<string, unknown>
    if (!res.ok || payload.success === false) {
      return { success: false, ...normalizeApiError(res.status, payload) }
    }
    return payload as ActionResult<T>
  }

  return {
    create: (collection, data, recordId) =>
      execTool('records.create', { collection, data, recordId }),
    update: (collection, recordId, data) =>
      execTool('records.update', { collection, recordId, data }),
    remove: (collection, recordId) => execTool('records.delete', { collection, recordId }),
    deleteWhere: (collection, where, limit) =>
      execTool('records.deleteWhere', { collection, where, limit }),
    get: (collection, recordId) => execTool('records.get', { collection, recordId }),
    query: (collection, options) => execTool('records.query', { collection, ...options }),
    integration: callIntegration,
    registerUser: (options) => execTool('users.register', { ...options }),
  }
}
