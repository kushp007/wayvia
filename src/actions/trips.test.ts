import { describe, expect, it, vi } from 'vitest'
import { canCreate, canDelete, canRead, canUpdate, type ActionTools } from 'deepspace/worker'
import { tripsSchema } from '../schemas/trips-schema'
import { formatTripDate, tripDetails } from '../lib/trips'
import { tripActions } from './trips'

const details = {
  title: ' New York ',
  destination: ' New York City ',
  description: '',
  startDate: '2027-03-13',
  endDate: '2027-03-15',
  budget: 1200,
  image: '',
  interests: [],
}

function fixture() {
  const get = vi.fn(async (collection: string) => ({
    success: true,
    data: { record: { createdBy: 'owner', data: collection === 'users' ? { role: 'member' } : details } },
  }))
  const create = vi.fn(async () => ({ success: true, data: { recordId: 'trip-1' } }))
  const update = vi.fn(async () => ({ success: true, data: { recordId: 'trip-1' } }))
  const remove = vi.fn(async () => ({ success: true, data: { recordId: 'trip-1' } }))
  const tools = { get, create, update, remove }
  const context = { tools: tools as unknown as ActionTools, env: {} as never, callerJwt: 'unused' }
  return { tools, context }
}

describe('trip records', () => {
  it('validates dates and budgets and formats calendar days across DST', () => {
    expect(tripDetails.safeParse(details).success).toBe(true)
    for (const invalid of [
      { startDate: '2027-02-30' }, { endDate: '2027-03-12' }, { endDate: '2027-08-13' },
      { budget: Infinity }, { budget: -1 }, { title: ' ' }, { image: 'http://example.com/cover.png' },
    ]) expect(tripDetails.safeParse({ ...details, ...invalid }).success).toBe(false)
    expect(formatTripDate(details.startDate, { month: 'short', day: 'numeric' })).toBe('Mar 13')
    expect(formatTripDate(details.startDate, { month: 'short', day: 'numeric' }, 1)).toBe('Mar 14')
  })

  it('uses SDK RBAC for reads and blocks native writes for every role', () => {
    const record = { data: { collaborators: ['friend'] }, createdBy: 'owner', recordId: 'trip-1' }
    expect(canRead(tripsSchema, 'member', record, 'owner')).toBe(true)
    expect(canRead(tripsSchema, 'member', record, 'friend')).toBe(true)
    expect(canRead(tripsSchema, 'admin', record, 'stranger')).toBe(false)
    expect(canRead(tripsSchema, 'anonymous', record, 'owner')).toBe(false)
    for (const role of ['member', 'admin', 'viewer', 'anonymous']) {
      expect(canCreate(tripsSchema, role)).toBe(false)
      expect(canUpdate(tripsSchema, role, record, 'owner')).toBe(false)
      expect(canDelete(tripsSchema, role, record, 'owner')).toBe(false)
    }
  })

  it('creates using the authenticated identity and an allowlist of fields', async () => {
    const { tools, context } = fixture()
    const result = await tripActions['trip-create']({
      ...context, userId: 'owner', params: { recordId: 'victim-trip', details: { ...details, createdBy: 'victim', collaborators: ['friend'] } },
    })
    expect(result.success).toBe(true)
    expect(tools.create).toHaveBeenCalledWith('trips', { ...details, title: 'New York', destination: 'New York City' })
  })

  it('rejects edits and deletes by other users and saves a budget patch for the owner', async () => {
    const { tools, context } = fixture()
    const params = { recordId: 'trip-1', details: { budget: 25, title: 'Ignore this' } }
    const other = { ...context, userId: 'other', params }
    expect((await tripActions['trip-edit'](other)).success).toBe(false)
    expect((await tripActions['trip-budget'](other)).success).toBe(false)
    expect((await tripActions['trip-delete'](other)).success).toBe(false)
    expect(tools.update).not.toHaveBeenCalled()
    expect(tools.remove).not.toHaveBeenCalled()
    expect((await tripActions['trip-budget']({ ...other, userId: 'owner' })).success).toBe(true)
    expect(tools.update).toHaveBeenCalledWith('trips', 'trip-1', { budget: 25 })
    expect((await tripActions['trip-delete']({ ...other, userId: 'owner' })).success).toBe(true)
    expect(tools.remove).toHaveBeenCalledWith('trips', 'trip-1')
  })

  it('rejects anonymous or unregistered callers before writing', async () => {
    const { tools, context } = fixture()
    const params = { details }
    expect((await tripActions['trip-create']({ ...context, userId: 'anon-123', params })).success).toBe(false)
    expect(tools.get).not.toHaveBeenCalled()
    tools.get.mockResolvedValueOnce({ success: true, data: { record: { createdBy: 'viewer', data: { role: 'viewer' } } } })
    expect((await tripActions['trip-create']({ ...context, userId: 'viewer', params })).success).toBe(false)
    expect(tools.create).not.toHaveBeenCalled()
  })
})
