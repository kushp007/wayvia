import { useState, type FormEvent } from 'react'
import { CloudSun, MapPin, Plus, RefreshCw, Search, Sparkles } from 'lucide-react'
import { categories } from '@/lib/collaboration'
import type { SavedTrip } from '@/lib/trip-client'
import type { Place, Recommendation, Weather } from '@/lib/travel'
import { formatTripDate } from '@/lib/trips'
import { useTripCommand } from '@/lib/use-trip-command'
import { money, type ActivityDialogState } from './wayvia-activities'

type OpenActivity = (state: ActivityDialogState) => void
const formatNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 })

export function DestinationDiscovery({ trip, owner, open }: { trip: SavedTrip; owner: boolean; open: OpenActivity }) {
  const [places, setPlaces] = useState<Place[]>()
  const [loadedImages, setLoadedImages] = useState<Set<string>>(() => new Set())
  const [coverNotice, setCoverNotice] = useState('')
  const search = useTripCommand()
  const cover = useTripCommand()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPlaces(undefined)
    setLoadedImages(new Set())
    setCoverNotice('')
    cover.setError('')
    void search.run<Place[]>('travel-search', {
      recordId: trip.recordId, query: String(form.get('query') ?? ''), category: form.get('category'),
    }, setPlaces)
  }

  return <section className="tab-content" aria-label="Destination discovery">
    <form className="travel-form" onSubmit={submit}>
      <label>Search {trip.data.destination}<input name="query" maxLength={100} placeholder="Museums, coffee, parks…" disabled={search.pending} /></label>
      <label>Category<select name="category" disabled={search.pending}><option>All</option>{categories.map(category => <option key={category}>{category}</option>)}</select></label>
      <button className="button-primary" disabled={search.pending}><Search size={15} /> {search.pending ? 'Searching…' : search.error ? 'Retry search' : 'Search places'}</button>
    </form>
    <div className="wayvia-button-row"><button className="button-outline small-button" onClick={() => open({ action: 'create' })}><Plus size={15} /> Add an activity manually</button></div>
    {search.pending && <p role="status">Looking for places in {trip.data.destination}…</p>}
    {search.error && <p className="form-error" role="alert">{search.error}</p>}
    {cover.error && <p className="form-error" role="alert">{cover.error}</p>}
    {coverNotice && <p role="status">{coverNotice}</p>}
    {!places && !search.pending && !search.error && <div className="empty-state"><MapPin size={24} /><b>Find places worth adding</b><span>Search by name, type, or category in this trip’s destination.</span></div>}
    {places?.length === 0 && <div className="empty-state"><Search size={24} /><b>No matching places</b><span>Try a different search or category.</span></div>}
    {places && places.length > 0 && <div className="travel-results">
      {places.map(place => <article className="panel travel-card" key={place.id}>
        {place.image && <img src={place.image} alt="" loading="lazy" referrerPolicy="no-referrer"
          onLoad={() => setLoadedImages(current => new Set(current).add(place.image))}
          onError={event => { event.currentTarget.hidden = true }} />}
        <div>
          <h3>{place.title}</h3>
          {place.origin === 'web' && <span className="tag">Web result</span>}
          {place.rating !== undefined && <span className="tag">{formatNumber.format(place.rating)} / 5</span>}
          {place.location && <p><MapPin size={14} /> {place.location}</p>}
          {place.description && <p>{place.description}</p>}
          <div className="wayvia-button-row">
            <button className="button-primary" onClick={() => open({ action: 'create', draft: place })}><Plus size={15} /> Add to trip</button>
            {place.source && <a className="text-link" href={place.source} target="_blank" rel="noopener noreferrer">View source</a>}
            {owner && loadedImages.has(place.image) && place.image !== trip.data.image && <button className="button-outline" disabled={cover.pending}
              onClick={() => void cover.run('trip-cover', { recordId: trip.recordId, destination: trip.data.destination, image: place.image }, () => setCoverNotice('Trip cover updated.'))}>Use as trip cover</button>}
          </div>
        </div>
      </article>)}
    </div>}
  </section>
}

export function CurrentWeather({ trip }: { trip: SavedTrip }) {
  const [weather, setWeather] = useState<Weather>()
  const { run, pending, error } = useTripCommand()
  return <div className="panel weather-card">
    <div className="weather-top"><h3>Current weather</h3><CloudSun size={22} className="weather-icon" /></div>
    <p className="weather-note">{trip.data.destination}</p>
    {weather && <>
      <p className="travel-temperature"><strong>{formatNumber.format(weather.temperature)} °C</strong> <span>{weather.conditions}</span></p>
      <dl className="travel-weather-values">
        <div><dt>Feels like</dt><dd>{formatNumber.format(weather.feelsLike)} °C</dd></div>
        <div><dt>Humidity</dt><dd>{formatNumber.format(weather.humidity)}%</dd></div>
        <div><dt>Wind</dt><dd>{formatNumber.format(weather.windSpeed * 3.6)} km/h</dd></div>
      </dl>
      <p className="weather-note">Observed {new Date(weather.observedAt).toLocaleString()}. Current conditions only.</p>
    </>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button-outline small-button" disabled={pending}
      onClick={() => void run<Weather>('travel-weather', { recordId: trip.recordId }, setWeather)}>
      <RefreshCw size={14} /> {pending ? 'Loading weather…' : error ? 'Retry weather' : weather ? 'Refresh weather' : 'Load current weather'}
    </button>
  </div>
}

export function TravelPlanner({ trip, open }: { trip: SavedTrip; open: OpenActivity }) {
  const [recommendations, setRecommendations] = useState<Recommendation[]>()
  const { run, pending, error } = useTripCommand()
  return <section className="tab-content" aria-label="AI travel planner">
    <div className="panel travel-planner">
      <div><h3>Ideas for {trip.data.destination}</h3><p>Generate suggestions based on your dates, interests, group budget, and existing activities.</p></div>
      <button className="button-primary" disabled={pending} onClick={() => {
        setRecommendations(undefined)
        void run<Recommendation[]>('travel-plan', { recordId: trip.recordId }, setRecommendations)
      }}><Sparkles size={15} /> {pending ? 'Generating…' : error ? 'Retry generation' : recommendations ? 'Generate again' : 'Generate recommendations'}</button>
    </div>
    {pending && <p role="status">Putting together recommendations…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {recommendations && <>
      <p className="travel-estimate">AI-generated suggestions and estimated group costs in USD. Verify prices and availability before booking.</p>
      {!recommendations.length && <div className="empty-state"><b>No recommendations yet</b><span>Try generating another set.</span></div>}
      <div className="travel-results">{recommendations.map((item, index) => <article className="panel travel-card" key={item.title + index}>
        <div>
          <span className="tag">{item.category}</span>
          <h3>{item.title}</h3>
          {item.location && <p><MapPin size={14} /> {item.location}</p>}
          <p>{item.description}</p>
          <p><strong>{money(item.cost)} estimated group cost</strong>{item.date && <> · Suggested {formatTripDate(item.date, { month: 'short', day: 'numeric' })}</>}</p>
          <button className="button-primary" onClick={() => open({ action: 'create', draft: item })}><Plus size={15} /> Review and add</button>
        </div>
      </article>)}</div>
    </>}
  </section>
}
