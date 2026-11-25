import { z } from 'zod/v4'

export const TRIPS = 'trips'
export const DAY_MS = 86_400_000
export const MAX_TRIP_DAYS = 90

const dateOnly = z.iso.date({ error: 'Enter a valid calendar date.' })
const budget = z.number().min(0, 'Budget cannot be negative.').max(1_000_000_000, 'Budget must be at most $1 billion.')
const image = z.string().trim().max(2048).refine(value => !value || URL.canParse(value) && new URL(value).protocol === 'https:', 'Use an HTTPS image URL.')

export const tripDetails = z.object({
  title: z.string().trim().min(1, 'Enter a trip name.').max(120),
  destination: z.string().trim().min(1, 'Enter a destination.').max(120),
  description: z.string().trim().max(1000),
  startDate: dateOnly,
  endDate: dateOnly,
  budget,
  image,
  interests: z.array(z.string().trim().min(1).max(40)).max(12),
}).superRefine(({ startDate, endDate }, context) => {
  const days = tripDays(startDate, endDate)
  if (days < 1 || days > MAX_TRIP_DAYS) {
    context.addIssue({ code: 'custom', path: ['endDate'], message: 'Choose an end date on or after the start date, within 90 days.' })
  }
})

export const tripBudget = z.object({ budget })
export type TripDetails = z.infer<typeof tripDetails>
export type TripRecord = Omit<TripDetails, 'interests'> & { interests?: string[]; collaborators?: string[] }

export function tripDays(start: string, end: string) {
  return (Date.parse(end) - Date.parse(start)) / DAY_MS + 1
}

export function formatTripDate(date: string, options: Intl.DateTimeFormatOptions, dayOffset = 0) {
  const time = Date.parse(date) + dayOffset * DAY_MS
  return Number.isFinite(time) ? new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(time) : 'Date unavailable'
}

export function coverImage(value?: string) {
  if (value && URL.canParse(value) && new URL(value).protocol === 'https:') return value
  return undefined
}
