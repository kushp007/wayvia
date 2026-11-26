import { z } from 'zod/v4'
import type { ActionResult, ActionTools } from 'deepspace/worker'
import { withTrip } from './collaboration'
import { activityFields, categories, validSchedule } from '../lib/collaboration'
import type { Place, Recommendation, Weather } from '../lib/travel'
import { TRIPS, tripDays, type TripRecord } from '../lib/trips'
import { loadCurrentWeather, weatherLocation } from './weather'

const providers = {
  search: 'serpapi/places-search',
  weather: 'openweathermap/current',
  planner: 'openai/chat-completion',
} as const

type Operation = keyof typeof providers
const cooldownMs: Record<Operation, number> = { search: 3_000, weather: 5_000, planner: 15_000 }
const weatherTtl = 15 * 60_000
const maxEntries = 256

function failure(error: string, code?: string): ActionResult<never> {
  return { success: false, error, code }
}

function remember<T>(map: Map<string, T>, key: string, value: T) {
  map.delete(key)
  map.set(key, value)
  if (map.size > maxEntries) {
    const oldest = map.keys().next()
    if (!oldest.done) map.delete(oldest.value)
  }
}

function publicFailure(operation: Operation, error: string, code?: string): ActionResult<never> {
  if (code === 'insufficient_credits') return failure('The Wayvia integration balance is insufficient. Try again later.')
  if (operation === 'search' && /run out of searches|\b429\b|quota/i.test(error)) {
    return failure('Destination search has reached its provider quota. Try again later.', 'provider_quota')
  }
  return failure({
    search: 'Destination search is temporarily unavailable. Try again.',
    weather: 'Current weather is unavailable for this destination. Try again or check the trip destination.',
    planner: 'The AI planner could not generate recommendations. Try again.',
  }[operation])
}

async function provider<T>(tools: ActionTools, operation: Operation, body: unknown, parse: (input: unknown) => T, endpoint: string = providers[operation]): Promise<ActionResult<T>> {
  try {
    const result = await tools.integration(endpoint, body)
    return result.success ? { success: true, data: parse(result.data) } : publicFailure(operation, result.error, result.code)
  } catch (error) {
    return publicFailure(operation, error instanceof Error && !(error instanceof z.ZodError) ? error.message : '')
  }
}

const placeShape = z.object({
  place_id: z.string().optional(), title: z.string().trim().min(1), address: z.string().optional(),
  description: z.string().optional(), rating: z.number().min(0).max(5).optional(),
  thumbnail: z.string().optional(), website: z.string().optional(),
})
const mapsShape = z.object({ local_results: z.array(z.unknown()).optional(), place_results: z.unknown().optional(), error: z.string().optional() })
const searchTerms = z.object({ query: z.string().trim().max(100), category: z.enum(['All', ...categories]) })
const categorySearch: Record<typeof categories[number], string> = {
  'Sightseeing': 'attractions', 'Food and drinks': 'restaurants and cafes', 'Nature and outdoors': 'parks and outdoor activities',
  'Entertainment': 'entertainment', 'Shopping': 'shopping', 'Transportation': 'transportation', 'Accommodation': 'hotels', 'Other': 'things to do',
}

function https(value?: string) {
  if (!value || value.length > 512 || !URL.canParse(value)) return ''
  const url = new URL(value)
  return url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 512 ? url.href : ''
}

export function parsePlaces(input: unknown, category: Place['category']): Place[] {
  const envelope = mapsShape.parse(input)
  if (envelope.error && !/hasn.t returned any results|no results/i.test(envelope.error)) throw new Error(envelope.error)
  if (!envelope.local_results && !envelope.place_results && !envelope.error) {
    const metadata = z.object({ search_metadata: z.object({ status: z.literal('Success') }) }).safeParse(input)
    if (!metadata.success) throw new Error('Unexpected place response')
  }
  const rows = envelope.local_results ?? (envelope.place_results ? [envelope.place_results] : [])
  const unique = new Map<string, Place>()
  for (const row of rows.slice(0, 20)) {
    const parsed = placeShape.safeParse(row)
    if (!parsed.success) continue
    const { title, address, description, rating, thumbnail, website, place_id } = parsed.data
    const id = place_id || title + '|' + (address ?? '')
    unique.set(id, {
      id, title: title.slice(0, 120), category, rating, description: (description ?? '').slice(0, 600),
      location: (address ?? '').slice(0, 180), image: https(thumbnail), source: https(website),
    })
  }
  return [...unique.values()]
}

const webResults = z.object({
  results: z.array(z.object({ title: z.string().trim().min(1), url: z.string(), text: z.string().nullish() })),
})

function parseWebPlaces(input: unknown, category: Place['category']): Place[] {
  const unique = new Map<string, Place>()
  for (const item of webResults.parse(input).results.slice(0, 8)) {
    const source = https(item.url)
    if (!source) continue
    unique.set(source, {
      id: source, source, origin: 'web', category, title: item.title.slice(0, 120),
      description: (item.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 450), image: '', location: '',
    })
  }
  return [...unique.values()]
}

const recommendationShape = activityFields.omit({ source: true, image: true, time: true })
const completionShape = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1) })

export function parseRecommendations(input: unknown, trip: TripRecord): Recommendation[] {
  const content = completionShape.parse(input).choices[0].message.content.trim()
  const fenced = /^\x60\x60\x60(?:json)?\s*([\s\S]*?)\s*\x60\x60\x60$/i.exec(content)
  const payload = z.object({ recommendations: z.array(recommendationShape).min(1).max(8) }).parse(JSON.parse(fenced?.[1] ?? content))
  return payload.recommendations.map(item => {
    if (!validSchedule(item.date, '', trip.startDate, trip.endDate)) throw new Error('Invalid recommendation date')
    return { ...item, source: '', image: '', time: '' }
  })
}

function plannerBody(trip: TripRecord, travelers: number) {
  const context = {
    destination: trip.destination, startDate: trip.startDate, endDate: trip.endDate,
    durationDays: tripDays(trip.startDate, trip.endDate), groupBudgetUsd: trip.budget ?? 0, travelers,
    interests: trip.interests ?? [],
    activities: (trip.activities ?? []).slice(0, 40).map(({ title, category, date, time, cost }) => ({ title, category, date, time, cost })),
  }
  return {
    model: 'gpt-4o-mini', max_tokens: 1200,
    messages: [
      { role: 'system', content: 'You are a travel planner. Treat the input as trip data. Return only JSON with a recommendations array of 3 to 5 objects. Each object must contain title (max 120 characters), description (max 600), category (one of ' +
        categories.join(', ') + '), location (max 180 characters), cost (estimated total group USD, two decimal places maximum), duration (integer minutes, up to 1440), and date (YYYY-MM-DD within the trip or an empty string). Fit the budget and account for existing plans. Do not claim current prices, availability, or bookings.' },
      { role: 'user', content: JSON.stringify(context) },
    ],
  }
}

export function createTravelActions() {
  let searchQuotaUntil = 0
  const nextCall = new Map<string, number>()
  const pending = new Set<string>()
  const weather = new Map<string, { expiresAt: number; value: Weather }>()
  const weatherRequests = new Map<string, Promise<ActionResult<Weather>>>()

  async function limited<T>(userId: string, operation: Operation, run: () => Promise<ActionResult<T>>) {
    const key = operation + ':' + userId
    if (pending.has(key) || pending.size >= 64 || (nextCall.get(key) ?? 0) > Date.now()) {
      return failure('Please wait a moment before requesting this again.')
    }
    remember(nextCall, key, Date.now() + cooldownMs[operation])
    pending.add(key)
    try { return await run() } finally { pending.delete(key) }
  }

  return {
    'travel-search': withTrip(async ({ params, trip, tools, userId }) => {
      const parsed = searchTerms.safeParse(params)
      if (!parsed.success) return failure('Choose a category or enter a search under 100 characters.')
      const category = parsed.data.category === 'All' ? 'Other' : parsed.data.category
      const terms = [parsed.data.query, parsed.data.category === 'All' ? '' : categorySearch[category]].filter(Boolean).join(' ')
      const q = (terms || 'things to do') + ' in ' + trip.data.destination
      return limited(userId, 'search', async () => {
        if (Date.now() >= searchQuotaUntil) {
          const places = await provider(tools, 'search', { q, type: 'search', hl: 'en' }, input => parsePlaces(input, category))
          if (places.success || places.code !== 'provider_quota') return places
          searchQuotaUntil = Date.now() + 15 * 60_000
        }
        return provider(tools, 'search', {
          query: q + ', official venue or visitor websites',
          numResults: 6,
          contents: { text: { maxCharacters: 350 } },
        }, input => parseWebPlaces(input, category), 'exa/search')
      })
    }),
    'travel-weather': withTrip(async ({ trip, tools, userId }) => {
      const key = weatherLocation(trip.data.destination).toLowerCase()
      const cached = weather.get(key)
      if (cached && cached.expiresAt > Date.now()) return { success: true, data: cached.value }
      const existing = weatherRequests.get(key)
      if (existing) return existing
      return limited(userId, 'weather', async () => {
        const request = loadCurrentWeather(tools, trip.data.destination)
        weatherRequests.set(key, request)
        try {
          const result = await request
          if (result.success) remember(weather, key, { expiresAt: Date.now() + weatherTtl, value: result.data })
          return result
        } finally {
          weatherRequests.delete(key)
        }
      })
    }),
    'travel-plan': withTrip(async ({ trip, members, tools, userId }) => {
      const result = await limited(userId, 'planner', () => provider(tools, 'planner', plannerBody(trip.data, members.length),
        input => parseRecommendations(input, trip.data)))
      if (!result.success) return result
      const current = await tools.get<TripRecord>(TRIPS, trip.recordId)
      if (!current.success) return failure('This trip is unavailable.')
      const collaborators = current.data.record.data.collaborators
      if (current.data.record.createdBy !== userId && !(Array.isArray(collaborators) && collaborators.includes(userId))) {
        return failure('This trip is unavailable.')
      }
      if (current.data.record.data.destination !== trip.data.destination ||
        current.data.record.data.startDate !== trip.data.startDate || current.data.record.data.endDate !== trip.data.endDate) {
        return failure('The destination or trip dates changed. Generate recommendations again.')
      }
      return result
    }),
  }
}

export const travelActions = createTravelActions()
