import { describe, expect, it, vi } from 'vitest'
import type { ActionResult, ActionTools } from 'deepspace/worker'
import { createTravelActions, parsePlaces, parseRecommendations } from './travel'
import { loadCurrentWeather, weatherLocation } from './weather'
import type { TripRecord } from '../lib/trips'

const trip: TripRecord = {
  title: 'City weekend', destination: 'Boston, Massachusetts', description: '', startDate: '2027-03-13', endDate: '2027-03-15',
  budget: 350, image: '', interests: ['Museums'], collaborators: ['friend'],
}
const weather = { dt: 1795653693, temp: 2.84, feels_like: 0.28, humidity: 74, description: 'overcast clouds', wind_speed: 2.57 }
const activity = { title: 'Museum visit', description: 'See the collection.', category: 'Sightseeing', location: 'Boston', date: '2027-03-14', cost: 50.25, duration: 120 }
const plan = (item = activity) => ({ choices: [{ message: { content: '\x60\x60\x60json\n' + JSON.stringify({ recommendations: [item] }) + '\n\x60\x60\x60' } }] })

function fixture(data: unknown) {
  const actions = createTravelActions()
  const get = vi.fn(async () => ({ success: true, data: { record: { recordId: 'trip-1', createdBy: 'owner', data: trip } } }))
  const integration = vi.fn(async (_endpoint: string, _body: unknown): Promise<ActionResult> => ({ success: true, data }))
  const tools = { get, integration }
  const run = (action: keyof typeof actions, userId = 'owner', params: Record<string, unknown> = {}) =>
    actions[action]({ userId, params: { recordId: 'trip-1', ...params }, tools: tools as unknown as ActionTools, callerJwt: '', env: {} as never })
  return { run, integration, get }
}

describe('native trip integrations', () => {
  it('scope-checks all paid calls and builds search from server-owned trip destination', async () => {
    const raw = { local_results: [{ place_id: 'a', title: 'Art museum', rating: 4.6, address: 'Boston', thumbnail: 'https://example.test/art.png' }] }
    const { run, integration } = fixture(raw)
    expect((await run('travel-search', 'stranger', { query: 'museum', category: 'All' })).success).toBe(false)
    expect((await run('travel-weather', 'stranger')).success).toBe(false)
    expect((await run('travel-plan', 'stranger')).success).toBe(false)
    expect(integration).not.toHaveBeenCalled()
    const result = await run('travel-search', 'friend', { query: 'art museum', category: 'All', destination: 'New York' })
    expect(integration).toHaveBeenCalledWith('serpapi/places-search', { q: 'art museum in Boston, Massachusetts', type: 'search', hl: 'en' })
    expect(result).toMatchObject({ success: true, data: [{ title: 'Art museum', rating: 4.6, image: 'https://example.test/art.png' }] })
    expect(parsePlaces({ local_results: [{ title: 'Park', thumbnail: 'javascript:bad' }] }, 'Other')[0].image).toBe('')
  })

  it('shares one current-weather response across simultaneous requests and subsequent refreshes', async () => {
    const { run, integration } = fixture(weather)
    const results = await Promise.all([run('travel-weather'), run('travel-weather', 'friend')])
    expect(results[0]).toMatchObject({ success: true, data: { temperature: 2.84, humidity: 74, windSpeed: 2.57, observedAt: 1795653693000 } })
    expect(results[0]).toEqual(results[1])
    expect(await run('travel-weather')).toEqual(results[0])
    expect(integration).toHaveBeenCalledExactlyOnceWith('openweathermap/current', { location: 'Boston,MA,US', units: 'metric' })
  })

  it('builds the planner context from records and rejects unsafe or stale suggestions', async () => {
    const { run, integration } = fixture(plan())
    expect(await run('travel-plan', 'friend')).toMatchObject({ success: true, data: [{ ...activity, image: '', time: '', source: '' }] })
    const [endpoint, body] = integration.mock.calls[0]
    expect(endpoint).toBe('openai/chat-completion')
    expect(body).toMatchObject({ model: 'gpt-4o-mini', messages: [{ role: 'system' }, { role: 'user' }] })
    expect(JSON.stringify(body)).toContain('groupBudgetUsd')
    expect(JSON.stringify(body)).toContain('Museum')
    expect(() => parseRecommendations(plan({ ...activity, date: '2027-03-16' }), trip)).toThrow()
    expect(() => parseRecommendations(plan({ ...activity, cost: -1 }), trip)).toThrow()
  })

  it('shows no synthetic places when SerpApi is unavailable', async () => {
    const { run } = fixture({ error: 'Your account has run out of searches' })
    expect(await run('travel-search', 'owner', { query: '', category: 'All' })).toMatchObject({ success: false })
  })

  it('uses Exa after the managed quota fails and does not add ratings or images to web results', async () => {
    const { run, integration } = fixture({})
    integration.mockResolvedValueOnce({ success: false, code: 'upstream_provider_error', error: 'SerpAPI error 429: Your account has run out of searches.' })
    const web = { success: true, data: { results: [{ title: 'City parks', url: 'https://example.test/parks', text: 'Official visitor information.' }] } } as const
    integration.mockResolvedValueOnce(web).mockResolvedValueOnce(web)
    const result = await run('travel-search', 'owner', { query: 'parks', category: 'All' })
    expect(result).toMatchObject({ success: true, data: [{ title: 'City parks', source: 'https://example.test/parks', origin: 'web', image: '', location: '' }] })
    expect(await run('travel-search', 'friend', { query: 'parks', category: 'All' })).toEqual(result)
    expect(integration.mock.calls.map(([endpoint]) => endpoint)).toEqual(['serpapi/places-search', 'exa/search', 'exa/search'])
  })
})

describe('current weather location handling', () => {
  it('normalizes the reported New York destination and preserves regional and international qualifiers', () => {
    expect(weatherLocation(' New York City, NY ')).toBe('New York,NY,US')
    expect(weatherLocation('Boston, Massachusetts')).toBe('Boston,MA,US')
    expect(weatherLocation('New York, New York, United States')).toBe('New York,NY,US')
    expect(weatherLocation('Tokyo, Japan')).toBe('Tokyo,JP')
    expect(weatherLocation('London, United Kingdom')).toBe('London,GB')
    expect(weatherLocation('Mexico City, Mexico')).toBe('Mexico City,MX')
  })

  it('geocodes a missing city and retries current weather with the resolved name', async () => {
    const integration = vi.fn()
      .mockResolvedValueOnce({ success: false, error: 'OpenWeatherMap API error: 404 - city not found', status: 502 })
      .mockResolvedValueOnce({ success: true, data: [{ name: 'London', state: 'England', country: 'GB', lat: 51.5, lon: -0.12 }] })
      .mockResolvedValueOnce({ success: true, data: weather })
    expect(await loadCurrentWeather({ integration } as unknown as ActionTools, 'Greater London, UK')).toMatchObject({ success: true, data: { temperature: 2.84 } })
    expect(integration.mock.calls).toEqual([
      ['openweathermap/current', { location: 'Greater London,GB', units: 'metric' }],
      ['openweathermap/geocoding', { q: 'Greater London,GB', limit: 3 }],
      ['openweathermap/current', { location: 'London,GB', units: 'metric' }],
    ])
  })

  it('does not attempt geocoding for billing failures', async () => {
    const integration = vi.fn().mockResolvedValue({ success: false, code: 'insufficient_credits', error: 'Insufficient credits' })
    expect(await loadCurrentWeather({ integration } as unknown as ActionTools, 'Tokyo, Japan')).toMatchObject({ success: false, error: expect.stringContaining('balance') })
    expect(integration).toHaveBeenCalledTimes(1)
  })

  it('tries the US interpretation for a state abbreviation while respecting an explicit country name', async () => {
    for (const [destination, expected] of [['San Francisco, CA', 'San Francisco,CA,US'], ['San Francisco, Canada', 'San Francisco,CA']]) {
      const integration = vi.fn()
        .mockResolvedValueOnce({ success: false, error: 'city not found' })
        .mockResolvedValueOnce({ success: true, data: [] })
      expect((await loadCurrentWeather({ integration } as unknown as ActionTools, destination)).success).toBe(false)
      expect(integration).toHaveBeenNthCalledWith(2, 'openweathermap/geocoding', { q: expected, limit: 3 })
    }
  })
})
