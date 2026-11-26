import { isAnonymousUserId, timingSafeEqualHex, type ActionContext, type ActionHandler, type ActionResult } from 'deepspace/worker'
import type { Env } from '../../worker'
import { activityFields, INVITE_LIFETIME, MAX_ACTIVITIES, MAX_TRAVELERS, scheduleFields, validSchedule, type Activity, type MemberProfile } from '../lib/collaboration'
import { TRIPS, type TripRecord } from '../lib/trips'
import type { CommonsCover } from './commons-cover'

type Context = ActionContext<Env>
type Trip = { recordId: string; createdBy: string; data: TripRecord }
type TripContext = Context & { trip: Trip; owner: boolean; members: string[] }
type Operation = (context: TripContext) => Promise<ActionResult>
const unavailable = { success: false, error: 'This trip is unavailable.' } as const
const invalidInvite = { success: false, error: 'This invitation is invalid.' } as const
const fail = (error: string) => ({ success: false, error } as const)
const success = <T>(data: T) => ({ success: true, data } as const)

async function readTrip(tools: Context['tools'], id: unknown): Promise<Trip | undefined> {
  if (typeof id !== 'string' || !id || id.length > 128) return
  const result = await tools.get<TripRecord>(TRIPS, id)
  if (result.success) return result.data.record
}

function memberIds(trip: Trip) {
  return [...new Set([trip.createdBy, ...(Array.isArray(trip.data.collaborators) ? trip.data.collaborators : [])])]
}

export function withTrip(operation: Operation, ownerOnly = false): ActionHandler<Env> {
  return async context => {
    const { userId, params, tools } = context
    if (!userId || isAnonymousUserId(userId)) return unavailable
    const trip = await readTrip(tools, params.recordId)
    if (!trip) return unavailable
    const members = memberIds(trip)
    const owner = trip.createdBy === userId
    if (!members.includes(userId) || ownerOnly && !owner) return unavailable
    return operation({ ...context, trip, members, owner })
  }
}

async function writeTrip({ trip, tools }: TripContext, patch: Partial<TripRecord>) {
  const result = await tools.update<TripRecord>(TRIPS, trip.recordId, patch)
  return result.success ? success({ recordId: trip.recordId }) : fail('DeepSpace could not save this change.')
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

async function hashToken(token: string) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))))
}

const inviteCreate = withTrip(async context => {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)))
  const expiresAt = Date.now() + INVITE_LIFETIME
  const result = await writeTrip(context, { invitation: { hash: await hashToken(token), expiresAt, revoked: false } })
  return result.success ? success({ invite: context.trip.recordId + '.' + token, expiresAt }) : result
}, true)

const inviteRevoke = withTrip(async context => {
  const invitation = context.trip.data.invitation
  return invitation ? writeTrip(context, { invitation: { ...invitation, revoked: true } }) : success({})
}, true)

const inviteAccept: ActionHandler<Env> = async context => {
  const { userId, params, tools } = context
  if (!userId || isAnonymousUserId(userId) || typeof params.invite !== 'string') return invalidInvite
  const match = /^([\w-]{1,128})\.([a-f0-9]{64})$/.exec(params.invite)
  if (!match) return invalidInvite
  const [, tripId, token] = match
  const trip = await readTrip(tools, tripId)
  const invitation = trip?.data.invitation
  if (!trip || !invitation || !(await timingSafeEqualHex(invitation.hash, await hashToken(token)))) return invalidInvite
  if (invitation.revoked) return fail('This invitation was revoked.')
  if (invitation.expiresAt <= Date.now()) return fail('This invitation expired.')
  const members = memberIds(trip)
  if (members.includes(userId)) return success({ recordId: trip.recordId })
  if (members.length >= MAX_TRAVELERS) return fail('This trip has reached its traveler limit.')
  const result = await tools.update<TripRecord>(TRIPS, trip.recordId, {
    collaborators: [...members.filter(id => id !== trip.createdBy), userId],
  })
  return result.success ? success({ recordId: trip.recordId }) : fail('Could not join this trip. Try again.')
}

const membersRead = withTrip(async ({ tools, trip, members }) => {
  const profiles = await Promise.all(members.map(async (id): Promise<MemberProfile> => {
    const user = await tools.get('users', id)
    const data = user.success ? user.data.record.data : undefined
    return {
      id, owner: id === trip.createdBy,
      name: typeof data?.name === 'string' && data.name.trim() ? data.name.trim() : 'Traveler',
      imageUrl: typeof data?.imageUrl === 'string' ? data.imageUrl : undefined,
    }
  }))
  return success(profiles)
})

async function removeMember(context: TripContext, id: unknown, revoke: boolean) {
  const { trip, members } = context
  if (typeof id !== 'string' || id === trip.createdBy || !members.includes(id)) return fail('This traveler cannot be removed.')
  const invitation = trip.data.invitation
  return writeTrip(context, {
    collaborators: members.filter(member => member !== id && member !== trip.createdBy),
    activities: (trip.data.activities ?? []).map(activity => ({
      ...activity, votes: activity.votes.filter(voter => voter !== id),
    })),
    ...(revoke && invitation ? { invitation: { ...invitation, revoked: true } } : {}),
  })
}

const activityCreate = withTrip(async context => {
  const { trip, params, userId } = context
  const parsed = activityFields.safeParse(params.details)
  if (!parsed.success) return fail('Enter valid activity details and a nonnegative cost with up to two decimal places.')
  const { date, time } = parsed.data
  if (!validSchedule(date, time, trip.data.startDate, trip.data.endDate)) return fail('Choose a date within the trip before setting a time.')
  const activities = trip.data.activities ?? []
  if (activities.length >= MAX_ACTIVITIES) return fail('This trip has reached its activity limit.')
  const now = new Date().toISOString()
  return writeTrip(context, {
    activities: [...activities, { ...parsed.data, id: crypto.randomUUID(), creator: userId, createdAt: now, updatedAt: now, votes: [] }],
  })
})

function activityChange(operation: 'edit' | 'delete' | 'schedule' | 'vote') {
  return withTrip(async context => {
    const { trip, params, owner, userId } = context
    const activities = trip.data.activities ?? []
    const index = activities.findIndex(activity => activity.id === params.activityId)
    if (index === -1) return fail('This activity is unavailable.')
    const activity = activities[index]
    if ((operation === 'edit' || operation === 'delete') && !owner && activity.creator !== userId) {
      return fail('Only the trip owner or activity creator can change these details.')
    }
    if (operation === 'delete') return writeTrip(context, { activities: activities.filter(item => item.id !== activity.id) })
    let next: Activity
    if (operation === 'vote') {
      if (typeof params.active !== 'boolean') return fail('Choose whether to add or remove the vote.')
      if (activity.votes.includes(userId) === params.active) return success({ recordId: trip.recordId })
      next = { ...activity, votes: params.active ? [...activity.votes, userId] : activity.votes.filter(id => id !== userId) }
    } else {
      const parsed = (operation === 'edit' ? activityFields.omit({ date: true, time: true }) : scheduleFields).safeParse(params.details)
      if (!parsed.success) return fail('Enter valid activity details.')
      if ('date' in parsed.data && !validSchedule(parsed.data.date, parsed.data.time, trip.data.startDate, trip.data.endDate)) {
        return fail('Choose a date within the trip before setting a time.')
      }
      next = { ...activity, ...parsed.data, updatedAt: new Date().toISOString() }
    }
    return writeTrip(context, { activities: activities.map((item, position) => position === index ? next : item) })
  })
}

export const applyCommonsCover = withTrip(async context => {
  // Only the internal Worker route can supply provider-validated metadata.
  const { destination, previousImage } = context.params
  const cover = context.params.cover as CommonsCover
  if (destination !== context.trip.data.destination || previousImage !== (context.trip.data.image ?? '')) {
    return success({ updated: false })
  }
  const result = await writeTrip(context, { image: cover.image, coverAttribution: cover.attribution })
  return result.success ? success({ updated: true }) : result
}, true)

export const collaborationActions = {
  'trip-cover': withTrip(async context => {
    const { destination, image } = context.params
    if (destination !== context.trip.data.destination || typeof image !== 'string' || image.length > 512 ||
      !URL.canParse(image) || new URL(image).protocol !== 'https:') return fail('Choose a valid image for the current destination.')
    return writeTrip(context, { image, coverAttribution: null })
  }, true),
  'invite-create': inviteCreate, 'invite-revoke': inviteRevoke, 'invite-accept': inviteAccept,
  'members-read': membersRead,
  'member-remove': withTrip(context => removeMember(context, context.params.memberId, true), true),
  'member-leave': withTrip(context => removeMember(context, context.userId, false)),
  'activity-create': activityCreate, 'activity-edit': activityChange('edit'), 'activity-delete': activityChange('delete'),
  'activity-schedule': activityChange('schedule'), 'activity-vote': activityChange('vote'),
}
