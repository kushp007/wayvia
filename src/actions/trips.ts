import { isAnonymousUserId, type ActionHandler, type ActionResult } from 'deepspace/worker'
import type { Env } from '../../worker'
import { TRIPS, tripBudget, tripDetails, tripEdits, type TripRecord } from '../lib/trips'
import { validSchedule } from '../lib/collaboration'

const unavailable = { success: false, error: 'This trip is unavailable.' } as const

function tripAction(operation: 'create' | 'edit' | 'budget' | 'delete'): ActionHandler<Env> {
  return async ({ userId, params, tools }) => {
    if (!userId || isAnonymousUserId(userId)) return unavailable

    // These tools bypass record RBAC. Authorize every existing row from the
    // SDK's immutable creator metadata before attempting a mutation.
    const account = await tools.get('users', userId)
    const role = account.success ? account.data.record.data.role : undefined
    if (role !== 'member' && role !== 'admin') {
      return { success: false, error: 'Your account does not have permission to change trips.' }
    }

    const id = typeof params.recordId === 'string' ? params.recordId : ''
    let trip: TripRecord | undefined
    if (operation !== 'create') {
      if (!id || id.length > 128) return unavailable
      const result = await tools.get<TripRecord>(TRIPS, id)
      if (!result.success || result.data.record.createdBy !== userId) return unavailable
      trip = result.data.record.data
      if (operation === 'delete') return mutationResult(await tools.remove(TRIPS, id))
    }

    if (operation === 'budget') {
      const parsed = tripBudget.safeParse(params.details)
      if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
      return mutationResult(await tools.update(TRIPS, id, parsed.data))
    }
    const schema = operation === 'edit' ? tripEdits : tripDetails
    const parsed = schema.safeParse(params.details)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
    const { startDate, endDate } = parsed.data
    if (trip?.activities?.some(item => !validSchedule(item.date, item.time, startDate, endDate))) {
      return { success: false, error: 'Move or unschedule activities outside the new dates before saving.' }
    }
    return mutationResult(operation === 'create'
      ? await tools.create(TRIPS, parsed.data)
      : await tools.update(TRIPS, id, parsed.data))
  }
}

function mutationResult(result: ActionResult<{ recordId: string }>): ActionResult<{ recordId: string }> {
  return result.success ? result : { success: false, error: 'DeepSpace could not save this change. Refresh your trips before retrying.' }
}

export const tripActions = {
  'trip-create': tripAction('create'),
  'trip-edit': tripAction('edit'),
  'trip-budget': tripAction('budget'),
  'trip-delete': tripAction('delete'),
}
