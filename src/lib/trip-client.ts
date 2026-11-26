import { getAuthToken, type RecordData } from 'deepspace'
import type { TripDetails, TripRecord } from './trips'

export type SavedTrip = RecordData<TripRecord>
export type TripOperation = 'create' | 'edit' | 'budget' | 'delete'

export async function tripRequest<T>(action: string, params: Record<string, unknown>): Promise<T> {
  const token = await getAuthToken()
  if (!token) throw new Error('Your session expired. Sign in to continue.')

  let response: Response
  try {
    response = await fetch('/api/actions/' + action, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    })
  } catch {
    throw new Error('The connection dropped before Wayvia could confirm the change. Check your trips before retrying.')
  }

  if (response.status === 401) throw new Error('Your session expired. Sign in to continue.')
  if (!response.ok) throw new Error('Wayvia could not confirm the change. Check your trips before retrying.')
  const result = await response.json() as
    | { success: true; data: T }
    | { success: false; error: string }
  if (!result.success) throw new Error(result.error)
  return result.data
}

export async function saveTrip(operation: TripOperation, recordId?: string, details?: TripDetails | { budget: number }) {
  const result = await tripRequest<{ recordId: string }>('trip-' + operation, { recordId, details })
  return result.recordId
}
