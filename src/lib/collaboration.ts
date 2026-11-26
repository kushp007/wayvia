import { z } from 'zod/v4'
import { DAY_MS } from './trips'

export const categories = ['Sightseeing', 'Food and drinks', 'Nature and outdoors', 'Entertainment', 'Shopping', 'Transportation', 'Accommodation', 'Other'] as const
export const MAX_ACTIVITIES = 150
export const MAX_TRAVELERS = 32
export const INVITE_LIFETIME = 7 * DAY_MS

const httpsUrl = z.string().trim().max(512).refine(value => !value || URL.canParse(value) && new URL(value).protocol === 'https:', 'Use a valid HTTPS URL.')
export const scheduleFields = z.object({
  date: z.union([z.literal(''), z.iso.date()]),
  time: z.union([z.literal(''), z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)]),
})
export const activityFields = scheduleFields.extend({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600),
  category: z.enum(categories),
  location: z.string().trim().max(180),
  cost: z.number().min(0).max(1_000_000).multipleOf(0.01),
  duration: z.number().int().min(0).max(1440),
  source: httpsUrl,
  image: httpsUrl,
})
export type ActivityInput = z.infer<typeof activityFields>
export type Activity = ActivityInput & {
  id: string
  creator: string
  createdAt: string
  updatedAt: string
  votes: string[]
}
export type MemberProfile = { id: string; name: string; imageUrl?: string; owner: boolean }
export type Invitation = { hash: string; expiresAt: number; revoked: boolean }
export type TripCollaboration = { activities?: Activity[]; invitation?: Invitation | null }

export function validSchedule(date: string, time: string, start: string, end: string) {
  return date ? date >= start && date <= end : !time
}

export function itinerary(activities: Activity[]) {
  return activities.filter(activity => !!activity.date).sort((a, b) =>
    a.date.localeCompare(b.date) || (a.time || '24:00').localeCompare(b.time || '24:00') || a.createdAt.localeCompare(b.createdAt))
}

export function budgetSummary(activities: Activity[], target: number, travelers: number) {
  const byCategory: Partial<Record<Activity['category'], number>> = {}
  let cents = 0
  for (const activity of itinerary(activities)) {
    const cost = Math.round(activity.cost * 100)
    cents += cost
    byCategory[activity.category] = (byCategory[activity.category] ?? 0) + cost
  }
  const total = cents / 100
  return {
    total, remaining: (Math.round(target * 100) - cents) / 100,
    percentage: target > 0 ? Math.round(total / target * 100) : null,
    over: cents > Math.round(target * 100),
    perTraveler: travelers > 0 ? total / travelers : 0,
    breakdown: categories.map(category => ({ category, total: (byCategory[category] ?? 0) / 100 })),
  }
}
