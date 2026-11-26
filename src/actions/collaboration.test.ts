import { afterEach, describe, expect, it, vi } from 'vitest'
import { canRead, type ActionTools } from 'deepspace/worker'
import { budgetSummary, itinerary, type ActivityInput } from '../lib/collaboration'
import type { TripRecord } from '../lib/trips'
import { tripsSchema } from '../schemas/trips-schema'
import { collaborationActions } from './collaboration'
import { tripActions } from './trips'

const details: ActivityInput = {
  title: 'Museum', description: '', category: 'Sightseeing', location: 'Downtown',
  cost: 75.25, duration: 60, source: '', image: '', date: '', time: '',
}
function fixture() {
  const data: TripRecord = {
    title: 'Weekend', destination: 'Boston', description: '', budget: 100,
    startDate: '2027-03-13', endDate: '2027-03-15', image: '', collaborators: [], activities: [],
  }
  const record = { recordId: 'trip-1', createdBy: 'owner', data }
  const privateRecord = { recordId: 'trip-2', createdBy: 'outsider', data: { ...data } }
  const tools = {
    get: vi.fn(async (collection: string, id: string) => {
      if (collection === 'users') return { success: true, data: { record: { data: { role: 'member', name: id, email: 'private@example.test' } } } }
      const found = [record, privateRecord].find(item => item.recordId === id)
      return found ? { success: true, data: { record: structuredClone(found) } } : { success: false }
    }),
    update: vi.fn(async (_collection: string, id: string, patch: Partial<TripRecord>) => {
      const found = [record, privateRecord].find(item => item.recordId === id)!
      Object.assign(found.data, structuredClone(patch))
      return { success: true, data: { recordId: id } }
    }),
  }
  const actions = { ...collaborationActions, ...tripActions }
  const run = (action: keyof typeof actions, userId: string, params: Record<string, unknown> = {}) =>
    actions[action]({ userId, params: { recordId: 'trip-1', ...params }, tools: tools as unknown as ActionTools, callerJwt: '', env: {} as never })
  async function invite() {
    const result = await run('invite-create', 'owner')
    if (!result.success) throw new Error(result.error)
    return (result.data as { invite: string }).invite
  }
  return { data, record, privateRecord, tools, run, invite }
}

afterEach(() => vi.useRealTimers())

describe('shared trip actions', () => {
  it('accepts a hashed link once per account without exposing private email', async () => {
    const { run, data, record, invite, tools } = fixture()
    const token = await invite()
    expect(data.invitation?.hash).toMatch(/^[a-f0-9]{64}$/)
    expect(token).not.toContain(data.invitation?.hash)
    expect((await run('invite-accept', 'friend', { invite: token })).success).toBe(true)
    expect((await run('invite-accept', 'friend', { invite: token })).success).toBe(true)
    expect(data.collaborators).toEqual(['friend'])
    expect(tools.update).toHaveBeenCalledTimes(2)
    expect(canRead(tripsSchema, 'member', record, 'friend')).toBe(true)
    expect(await run('members-read', 'friend')).toEqual({ success: true, data: [
      { id: 'owner', name: 'owner', owner: true, imageUrl: undefined },
      { id: 'friend', name: 'friend', owner: false, imageUrl: undefined },
    ] })
  })

  it('rejects unauthorized generation, tampering, trip IDs, expired and revoked links', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { invite, run, data } = fixture()
    expect((await run('invite-create', 'outsider')).success).toBe(false)
    expect((await run('invite-accept', 'outsider')).success).toBe(false)
    const token = await invite()
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a')
    expect(await run('invite-accept', 'outsider', { invite: tampered })).toMatchObject({ error: expect.stringContaining('invalid') })
    expect((await run('invite-accept', 'anon-hidden', { invite: token })).success).toBe(false)
    vi.setSystemTime(data.invitation!.expiresAt)
    expect(await run('invite-accept', 'outsider', { invite: token })).toMatchObject({ error: expect.stringContaining('expired') })
    const replacement = await invite()
    expect((await run('invite-revoke', 'outsider')).success).toBe(false)
    expect((await run('invite-revoke', 'owner')).success).toBe(true)
    expect(await run('invite-accept', 'outsider', { invite: replacement })).toMatchObject({ error: expect.stringContaining('revoked') })
  })

  it('revokes membership, cleans up votes and blocks reuse of the former link', async () => {
    const { invite, run, data, record } = fixture()
    const token = await invite()
    await run('invite-accept', 'friend', { invite: token })
    await run('activity-create', 'owner', { details })
    const activityId = data.activities![0].id
    await run('activity-vote', 'friend', { activityId, active: true })
    expect((await run('member-remove', 'friend', { memberId: 'owner' })).success).toBe(false)
    expect((await run('member-remove', 'owner', { memberId: 'friend' })).success).toBe(true)
    expect(canRead(tripsSchema, 'member', record, 'friend')).toBe(false)
    expect(data.activities![0].votes).toEqual([])
    expect((await run('members-read', 'friend')).success).toBe(false)
    expect((await run('activity-vote', 'friend', { activityId, active: true })).success).toBe(false)
    expect((await run('invite-accept', 'friend', { invite: token })).success).toBe(false)
    const fresh = await invite()
    await run('invite-accept', 'friend', { invite: fresh })
    expect((await run('member-leave', 'friend')).success).toBe(true)
    expect(canRead(tripsSchema, 'member', record, 'friend')).toBe(false)
    expect((await run('member-leave', 'owner')).success).toBe(false)
  })

  it('checks trip scope and limits edits to the creator and trip owner', async () => {
    const { invite, run, data, privateRecord } = fixture()
    await run('invite-accept', 'friend', { invite: await invite() })
    expect((await run('activity-create', 'outsider', { details })).success).toBe(false)
    expect((await run('activity-create', 'friend', { details: { ...details, creator: 'outsider', votes: ['owner'] } })).success).toBe(true)
    const { id: activityId, creator, votes } = data.activities![0]
    expect(creator).toBe('friend')
    expect(votes).toEqual([])
    expect((await run('activity-vote', 'outsider', { recordId: 'trip-2', activityId, active: true })).success).toBe(false)
    expect(privateRecord.data.activities).toEqual([])
    await run('activity-create', 'owner', { details })
    const ownerActivity = data.activities![1].id
    expect((await run('activity-edit', 'friend', { activityId: ownerActivity, details })).success).toBe(false)
    expect((await run('activity-delete', 'friend', { activityId: ownerActivity })).success).toBe(false)
    expect((await run('activity-edit', 'friend', { activityId, details: { ...details, title: 'New title' } })).success).toBe(true)
    expect((await run('activity-delete', 'owner', { activityId })).success).toBe(true)
    expect(data.activities!.map(activity => activity.id)).toEqual([ownerActivity])
  })

  it('adds and removes votes idempotently using the authenticated voter', async () => {
    const { invite, run, data } = fixture()
    await run('invite-accept', 'friend', { invite: await invite() })
    await run('activity-create', 'owner', { details })
    const activityId = data.activities![0].id
    for (const user of ['owner', 'friend', 'owner', 'friend']) {
      expect((await run('activity-vote', user, { activityId, active: true, voter: 'outsider' })).success).toBe(true)
    }
    expect(data.activities![0].votes).toEqual(['owner', 'friend'])
    await run('activity-vote', 'friend', { activityId, active: false })
    await run('activity-vote', 'friend', { activityId, active: false })
    expect(data.activities![0].votes).toEqual(['owner'])
  })

  it('validates schedule dates, protects date edits and derives the scheduled budget in cents', async () => {
    const { run, data } = fixture()
    await run('activity-create', 'owner', { details: { ...details, date: '2027-03-15', time: '09:15' } })
    await run('activity-create', 'owner', { details: { ...details, title: 'Unscheduled', cost: 999 } })
    const activityId = data.activities![0].id
    expect((await run('activity-schedule', 'owner', { activityId, details: { date: '2027-03-16', time: '' } })).success).toBe(false)
    expect((await run('activity-schedule', 'owner', { activityId, details: { date: '', time: '10:00' } })).success).toBe(false)
    const edit = { ...data, endDate: '2027-03-14', interests: [] }
    expect((await run('trip-edit', 'owner', { details: edit })).success).toBe(false)
    expect(itinerary(data.activities!).map(activity => activity.id)).toEqual([activityId])
    expect(budgetSummary(data.activities!, 50, 2)).toMatchObject({ total: 75.25, remaining: -25.25, percentage: 151, over: true, perTraveler: 37.625 })
    expect(budgetSummary(data.activities!, 100, 1).breakdown.find(row => row.category === 'Sightseeing')?.total).toBe(75.25)
    await run('activity-schedule', 'owner', { activityId, details: { date: '', time: '' } })
    expect((await run('trip-edit', 'owner', { details: edit })).success).toBe(true)
    expect(budgetSummary(data.activities!, 100, 2).total).toBe(0)
  })
})
