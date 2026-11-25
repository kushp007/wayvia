import { isAnonymousUserId, type ActionHandler, type ActionResult } from 'deepspace/worker'
import type { Env } from '../../worker'
import { TRIPS, tripBudget, tripDetails } from '../lib/trips'

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
    if (operation !== 'create') {
      if (!id || id.length > 128) return unavailable
      const result = await tools.get(TRIPS, id)
      if (!result.success || result.data.record.createdBy !== userId) return unavailable
      if (operation === 'delete') return mutationResult(await tools.remove(TRIPS, id))
    }

    const parsed = (operation === 'budget' ? tripBudget : tripDetails).safeParse(params.details)
    if (!parsed.success) return { success: false, error: parsed.error.issues[0].message }
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
