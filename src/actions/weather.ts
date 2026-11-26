import { z } from 'zod/v4'
import type { ActionResult, ActionTools } from 'deepspace/worker'
import type { Weather } from '../lib/travel'

export const states: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky',
  LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}
const regionNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' })
const regionCodes = new Map<string, string>()
for (const left of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  for (const right of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    const code = left + right
    const name = regionNames.of(code)
    if (name && !regionCodes.has(name.toLowerCase())) regionCodes.set(name.toLowerCase(), code)
  }
}
const countryAliases = new Map([
  ['uk', 'GB'], ['united kingdom', 'GB'], ['usa', 'US'], ['united states of america', 'US'], ['czech republic', 'CZ'],
])

function countryCode(value: string) {
  const key = value.toLowerCase()
  const code = value.toUpperCase()
  return countryAliases.get(key) ?? regionCodes.get(key) ??
    (/^[A-Z]{2}$/.test(code) && regionNames.of(code) ? code : undefined)
}

function stateCode(value: string) {
  const upper = value.toUpperCase()
  return Object.hasOwn(states, upper) ? upper : Object.entries(states)
    .find(([, name]) => name.toLowerCase() === value.toLowerCase())?.[0]
}

export function weatherLocation(destination: string) {
  const parts = destination.normalize('NFKC').split(',').map(value => value.trim().replace(/\s+/g, ' ')).filter(Boolean)
  if (/^new york city$/i.test(parts[0] ?? '')) parts[0] = 'New York'
  const [city, qualifier, country] = parts
  if (!qualifier) return city ?? ''
  if (parts.length === 3) {
    const code = countryCode(country)
    if (code === 'US') return [city, stateCode(qualifier) ?? qualifier, code].join(',')
    if (code) return [city, code].join(',')
  }
  if (parts.length === 2) {
    const code = countryCode(qualifier)
    if (code) return [city, code].join(',')
    const state = stateCode(qualifier)
    if (state) return [city, state, 'US'].join(',')
  }
  return parts.join(',')
}

function geocodingQuery(location: string, destination: string) {
  const [city, qualifier, ...rest] = location.split(',')
  const original = destination.normalize('NFKC').split(',').map(part => part.trim())
  // A two-letter qualifier can be both a country and a US state. Try the
  // explicit US interpretation only after the country lookup finds no city.
  if (rest.length === 0 && qualifier && original.length === 2 && original[1].toUpperCase() === qualifier && Object.hasOwn(states, qualifier)) {
    return [city, qualifier, 'US'].join(',')
  }
  return location
}

const currentWeather = z.object({
  dt: z.number().int().positive().max(4_102_444_800), temp: z.number(), feels_like: z.number(),
  humidity: z.number().min(0).max(100), wind_speed: z.number().min(0), description: z.string().trim().min(1).max(120),
})
const geocoding = z.array(z.object({
  name: z.string().trim().min(1).max(120), country: z.string().regex(/^[A-Z]{2}$/), state: z.string().optional(),
}))

export function parseWeather(input: unknown): Weather {
  const value = currentWeather.parse(input)
  return {
    observedAt: value.dt * 1_000, temperature: value.temp, feelsLike: value.feels_like,
    humidity: value.humidity, windSpeed: value.wind_speed, conditions: value.description,
  }
}

const genericError = 'The weather provider is temporarily unavailable. Try again.'
const locationError = 'No current weather was found for this destination. Try a city with its state or country.'
function failure(error: string): ActionResult<never> {
  return { success: false, error }
}

function logFailure(stage: string, reason: string, status?: number) {
  console.warn('[travel-weather]', { stage, reason, status })
}

export async function loadCurrentWeather(tools: ActionTools, destination: string): Promise<ActionResult<Weather>> {
  const location = weatherLocation(destination)
  if (!location) return failure(locationError)
  let stage = 'current'
  try {
    const first = await tools.integration('openweathermap/current', { location, units: 'metric' })
    if (first.success) return { success: true, data: parseWeather(first.data) }
    if (!/city not found/i.test(first.error)) {
      logFailure(stage, first.code === 'insufficient_credits' ? 'insufficient_credits' : 'provider_error', first.status)
      return failure(first.code === 'insufficient_credits' ? 'The Wayvia integration balance is insufficient. Try again later.' : genericError)
    }

    logFailure(stage, 'city_not_found', first.status)
    stage = 'geocoding'
    const resolved = await tools.integration('openweathermap/geocoding', { q: geocodingQuery(location, destination), limit: 3 })
    if (!resolved.success) {
      logFailure(stage, 'provider_error', resolved.status)
      return failure(resolved.code === 'insufficient_credits' ? 'The Wayvia integration balance is insufficient. Try again later.' : genericError)
    }
    const candidates = geocoding.parse(resolved.data)
    const place = candidates[0]
    if (!place) {
      logFailure(stage, 'no_candidates')
      return failure(locationError)
    }
    // The managed current endpoint documents location/q, not lat/lon.
    const state = place.country === 'US' && place.state ? stateCode(place.state) : undefined
    const canonical = [place.name, state, place.country].filter(Boolean).join(',')
    if (canonical.toLowerCase() === location.toLowerCase()) return failure(locationError)
    stage = 'canonical_current'
    const current = await tools.integration('openweathermap/current', { location: canonical, units: 'metric' })
    if (current.success) return { success: true, data: parseWeather(current.data) }
    const missing = /city not found/i.test(current.error)
    logFailure(stage, missing ? 'city_not_found' : 'provider_error', current.status)
    return failure(missing ? locationError : genericError)
  } catch (error) {
    logFailure(stage, error instanceof z.ZodError ? 'unexpected_response' : 'transport_error')
    return failure(genericError)
  }
}
