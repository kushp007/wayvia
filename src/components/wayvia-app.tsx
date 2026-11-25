import { useState } from 'react'
import { useAuthProfileReady, useQuery, type UserProfile } from 'deepspace'
import { ArrowRight, BarChart3, CalendarDays, ChevronRight, CloudSun, Compass, DollarSign, LayoutDashboard, Lightbulb, ListChecks, MapPin, Menu, MoreHorizontal, Plus, Sparkles, Users, Vote, X } from 'lucide-react'
import { coverImage, DAY_MS, formatTripDate, MAX_TRIP_DAYS, tripDays, TRIPS, type TripRecord } from '@/lib/trips'
import type { SavedTrip } from '@/lib/trip-client'
import { AccountAvatar, accountName, WayviaAccount } from './wayvia-account'
import { TripDialog, WayviaDialog, type TripDialogState } from './wayvia-trip-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui'

const tabs = [
  { label: 'Overview', icon: LayoutDashboard }, { label: 'Discover', icon: Compass },
  { label: 'Voting', icon: Vote }, { label: 'Itinerary', icon: CalendarDays },
  { label: 'Budget', icon: BarChart3 }, { label: 'AI planner', icon: Sparkles },
] as const
type TripTab = typeof tabs[number]['label']
const money = (value: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2,
}).format(value)
const shortDate = { month: 'short', day: 'numeric' } as const
const longDate = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' } as const

export default function WayviaApp() {
  const { isSignedIn, user, userLoading } = useAuthProfileReady({ requireUser: true })
  if (!isSignedIn) return null
  if (!user || userLoading) return <div className="wayvia-loading" role="status">Loading your profile…</div>
  return <Workspace key={user.id} user={user} />
}

function Workspace({ user }: { user: UserProfile }) {
  const { records, status } = useQuery<TripRecord>(TRIPS, { orderBy: 'updatedAt', orderDir: 'desc' })
  const [selected, setSelected] = useState<string>()
  const [view, setView] = useState<'trip' | 'list'>('trip')
  const [tab, setTab] = useState<TripTab>('Overview')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [dialog, setDialog] = useState<TripDialogState>()
  const [notice, setNotice] = useState('')
  const trip = records.find(record => record.recordId === selected) ?? records[0]
  const selectedTrip = view === 'trip' ? trip : undefined

  function select(id: string) {
    setSelected(id)
    setView('trip')
    setTab('Overview')
    setMobileMenu(false)
    setNotice('')
  }

  function create() {
    setMobileMenu(false)
    setDialog({ operation: 'create' })
  }

  function list() {
    setView('list')
    setMobileMenu(false)
  }

  return <div className="app-shell" data-testid="app-navigation">
    <aside className={mobileMenu ? 'sidebar mobile-open' : 'sidebar'}>
      <div className="sidebar-brand">
        <div className="brand"><span className="brand-mark"><Compass size={19} strokeWidth={1.8} /></span><span>Wayvia</span></div>
        <button className="icon-button mobile-close" onClick={() => setMobileMenu(false)} aria-label="Close navigation"><X size={18} /></button>
      </div>
      <div className="workspace-picker"><AccountAvatar user={user} /><span><b>{accountName(user)}’s space</b><small>Personal workspace</small></span></div>
      <div className="nav-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Main navigation">
        <button className={view === 'trip' && tab === 'Overview' ? 'active' : ''} onClick={() => { setView('trip'); setTab('Overview'); setMobileMenu(false) }}><LayoutDashboard size={17} /><span>Overview</span></button>
        <button className={view === 'list' ? 'active' : ''} onClick={list}><MapPin size={17} /><span>My trips</span>{status === 'ready' && <span className="nav-count">{records.length}</span>}</button>
        {trip && <button className={view === 'trip' && tab === 'Discover' ? 'active' : ''} onClick={() => { setView('trip'); setTab('Discover'); setMobileMenu(false) }}><Compass size={17} /><span>Explore</span></button>}
      </nav>
      <div className="sidebar-section">
        <div className="nav-label">YOUR TRIPS <button aria-label="New trip" onClick={create} disabled={status !== 'ready'}><Plus size={14} /></button></div>
        {records.map(record => <button key={record.recordId} className={selectedTrip?.recordId === record.recordId ? 'trip-nav active-trip' : 'trip-nav'}
          aria-current={selectedTrip?.recordId === record.recordId ? 'true' : undefined} onClick={() => select(record.recordId)}>
          <span className="trip-nav-dot" /><span className="trip-nav-name">{record.data.title}</span>
        </button>)}
        {status === 'ready' && !records.length && <p className="sidebar-empty">No trips yet</p>}
      </div>
      <div className="sidebar-bottom"><WayviaAccount user={user} sidebar /></div>
    </aside>
    {mobileMenu && <button className="mobile-scrim" onClick={() => setMobileMenu(false)} aria-label="Close navigation overlay" />}

    <main className="main-area">
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-button mobile-menu-button" aria-label="Open navigation" onClick={() => setMobileMenu(true)}><Menu size={19} /></button>
          <div className="breadcrumbs"><button className="text-link" onClick={list}>My trips</button>{selectedTrip && <><ChevronRight size={14} /><b>{selectedTrip.data.title}</b></>}</div>
        </div>
        <div className="topbar-actions"><WayviaAccount user={user} /></div>
      </header>
      <div className="content-wrap">
        {status === 'loading' && <div className="panel empty-state" role="status">Loading your trips…</div>}
        {status === 'error' && <div className="panel empty-state" role="alert">
          <b>Could not load your trips</b><button className="button-outline" onClick={() => window.location.reload()}>Reload workspace</button>
        </div>}
        {status === 'ready' && (selectedTrip
          ? <TripWorkspace key={selectedTrip.recordId} trip={selectedTrip} user={user} tab={tab} setTab={setTab}
            edit={operation => setDialog({ operation, trip: selectedTrip })} />
          : <TripList trips={records} create={create} select={select} />)}
        <footer className="page-footer"><span>WAYVIA · YOUR JOURNEY. OUR WAY.</span></footer>
      </div>
    </main>

    {dialog && <TripDialog state={dialog} close={() => setDialog(undefined)} saved={id => {
      setDialog(undefined)
      if (dialog.operation === 'create') select(id)
      if (dialog.operation === 'delete') setSelected(undefined)
      setNotice({ create: 'Trip created.', edit: 'Trip details saved.', budget: 'Group budget saved.', delete: 'Trip deleted.' }[dialog.operation])
    }} />}
    {notice && <div className="toast" role="status">{notice}<button className="icon-button" aria-label="Dismiss message" onClick={() => setNotice('')}><X size={15} /></button></div>}
  </div>
}

function TripList({ trips, create, select }: { trips: SavedTrip[]; create: () => void; select: (id: string) => void }) {
  if (!trips.length) return <section className="trip-hero first-trip neutral-cover">
    <Compass size={42} aria-hidden="true" />
    <h1>Where to next?</h1>
    <p>Create your first trip to keep your dates, destination, and budget in one place.</p>
    <button className="button-primary" onClick={create}><Plus size={16} /> Create your first trip</button>
  </section>

  return <section>
    <div className="page-heading"><div><h1>My trips</h1></div><button className="button-primary" onClick={create}><Plus size={16} /> Create trip</button></div>
    <div className="saved-trip-grid">{trips.map(trip => <button className="panel saved-trip" key={trip.recordId} onClick={() => select(trip.recordId)}>
      <MapPin size={18} /><span><strong>{trip.data.title}</strong><small>{trip.data.destination}</small><small>{formatTripDate(trip.data.startDate, shortDate)} – {formatTripDate(trip.data.endDate, { ...shortDate, year: 'numeric' })}</small></span><ArrowRight size={16} />
    </button>)}</div>
  </section>
}

function TripWorkspace({ trip, user, tab, setTab, edit }: {
  trip: SavedTrip; user: UserProfile; tab: TripTab; setTab: (tab: TripTab) => void
  edit: (operation: 'edit' | 'budget' | 'delete') => void
}) {
  const [invite, setInvite] = useState(false)
  const { data } = trip
  const owner = trip.createdBy === user.id
  const cover = coverImage(data.image)
  const days = tripDays(data.startDate, data.endDate)
  const members = new Set([trip.createdBy, ...(Array.isArray(data.collaborators) ? data.collaborators : [])]).size

  return <>
    <section className="trip-hero neutral-cover">
      {cover && <img key={cover} className="trip-cover" src={cover} alt="" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true }} />}
      <div className="hero-topline">
        <span className="eyebrow"><span className="live-dot" />TRIP WORKSPACE</span>
        {owner && <DropdownMenu>
          <DropdownMenuTrigger render={<button className="hero-more" aria-label="Trip options" />}><MoreHorizontal size={20} /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="wayvia-account-popup">
            <DropdownMenuItem onClick={() => edit('edit')}>Edit trip details</DropdownMenuItem>
            <DropdownMenuItem onClick={() => edit('delete')}>Delete trip</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>
      <div className="trip-hero-content">
        <div className="trip-kicker"><MapPin size={14} />{data.destination}</div>
        <h1>{data.title}</h1>
        <p><CalendarDays size={15} /> {formatTripDate(data.startDate, shortDate)} – {formatTripDate(data.endDate, { ...shortDate, year: 'numeric' })}
          {days >= 1 && <><span className="hero-separator" />{days} {days === 1 ? 'day' : 'days'}</>}</p>
        <div className="trip-hero-actions">
          <button className="button-primary" onClick={() => setTab('Itinerary')}>View itinerary <ArrowRight size={15} /></button>
          <button className="button-ghost" onClick={() => setInvite(true)}><Users size={15} /> Invite friends</button>
        </div>
      </div>
      <div className="hero-members"><AccountAvatar user={user} /><span>{members} {members === 1 ? 'traveler' : 'travelers'}</span></div>
    </section>
    <section className="trip-toolbar">
      <div className="tab-list" role="tablist" aria-label="Trip workspace">{tabs.map(({ label, icon: Icon }) =>
        <button role="tab" aria-controls="trip-panel" aria-selected={tab === label} onClick={() => setTab(label)} key={label}
          className={tab === label ? 'selected' : ''}><Icon size={15} /><span>{label}</span></button>)}</div>
    </section>
    <div className="page-heading"><div><div className="overline">{formatTripDate(data.startDate, longDate)} <span className="heading-line" />{data.destination}</div>
      <h2>{tab === 'Overview' ? 'Your trip at a glance' : tab}</h2>
      {tab === 'Overview' && data.description && <p>{data.description}</p>}
      {tab === 'Overview' && !!data.interests?.length && <p>{data.interests.join(' · ')}</p>}
    </div></div>
    <div role="tabpanel" id="trip-panel" aria-label={tab}>
      {tab === 'Overview' && <Overview trip={data} members={members} days={days} showItinerary={() => setTab('Itinerary')} />}
      {tab === 'Discover' && <EmptyPanel icon={Compass} title="Destination discovery is unavailable" text={'Place search for ' + data.destination + ' is not connected yet.'} />}
      {tab === 'Voting' && <EmptyPanel icon={Lightbulb} title="No ideas to vote on" text="The group idea board and voting are not available yet." />}
      {tab === 'Itinerary' && <Itinerary key={data.startDate + data.endDate} trip={data} days={days} />}
      {tab === 'Budget' && <Budget amount={data.budget ?? 0} edit={owner ? () => edit('budget') : undefined} />}
      {tab === 'AI planner' && <EmptyPanel icon={Sparkles} title="AI planner is unavailable" text="Travel recommendations are not connected yet." />}
    </div>
    {invite && <WayviaDialog title="Invite friends" close={() => setInvite(false)}>
      <div className="invite-content"><p className="dialog-intro">Invitations are not available yet.</p></div>
    </WayviaDialog>}
  </>
}

function Overview({ trip, days, members, showItinerary }: { trip: TripRecord; days: number; members: number; showItinerary: () => void }) {
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const countdown = Math.max(0, (Date.parse(trip.startDate) - today) / DAY_MS)
  const metrics = [
    { label: 'DAYS TO GO', value: Number.isFinite(countdown) ? countdown : '—', note: 'Until departure', icon: CalendarDays, color: 'violet' },
    { label: 'ON THE ITINERARY', value: 0, note: days >= 1 ? 'Across ' + days + ' days' : 'No dates available', icon: ListChecks, color: 'teal' },
    { label: 'GROUP BUDGET', value: money(trip.budget ?? 0), note: 'Estimated total', icon: DollarSign, color: 'amber' },
    { label: 'YOUR CREW', value: members, note: members === 1 ? 'Traveler' : 'Travelers', icon: Users, color: 'rose' },
  ]

  return <>
    <section className="metrics-grid" aria-label="Trip summary">{metrics.map(({ label, value, note, icon: Icon, color }) => <article className="metric-card" key={label}>
      <span className={'metric-icon ' + color}><Icon size={17} /></span><span className="metric-label">{label}</span><strong>{value}</strong><small>{note}</small>
    </article>)}</section>
    <section className="overview-grid">
      <div className="panel itinerary-panel"><div className="panel-heading"><h3>Coming up</h3><button className="text-link" onClick={showItinerary}>Full itinerary <ArrowRight size={14} /></button></div>
        <EmptyPanel icon={CalendarDays} title="No activities scheduled" />
      </div>
      <div className="overview-right">
        <div className="panel weather-card"><div className="weather-top"><h3>Destination weather</h3><CloudSun size={22} className="weather-icon" /></div><p className="weather-note">Live weather is unavailable.</p></div>
        <div className="panel vote-picks"><div className="panel-heading"><h3>Group favorites</h3></div><p className="weather-note">No ideas have been voted on.</p></div>
      </div>
    </section>
  </>
}

function Itinerary({ trip, days }: { trip: TripRecord; days: number }) {
  const [day, setDay] = useState(0)
  const count = days >= 1 ? Math.min(days, MAX_TRIP_DAYS) : 0
  return <section className="tab-content itinerary-view">
    <div className="itinerary-head"><h3>{trip.destination}</h3></div>
    <div className="day-tabs">{Array.from({ length: count }, (_, index) => <button key={index} onClick={() => setDay(index)} className={index === day ? 'day-active' : ''}>
      <span>DAY {index + 1}</span><b>{formatTripDate(trip.startDate, { ...shortDate, weekday: 'long' }, index)}</b>
    </button>)}</div>
    {count > 0 && <div className="day-summary"><div><CalendarDays size={15} />{formatTripDate(trip.startDate, longDate, day)}</div></div>}
    <EmptyPanel icon={CalendarDays} title="No activities scheduled" />
  </section>
}

function Budget({ amount, edit }: { amount: number; edit?: () => void }) {
  return <section className="tab-content budget-view">
    <div className="budget-top-grid"><article className="panel budget-total">
      <div className="panel-heading"><h3>Trip budget</h3>{edit && <button className="text-link" onClick={edit}>Edit budget <ArrowRight size={14} /></button>}</div>
      <div className="budget-numbers"><div><span>Estimated group budget</span><strong>{money(amount)}</strong></div>
        <div className="budget-ring"><div><strong>0%</strong><span>planned</span></div></div>
      </div>
      <div className="budget-progress" /><div className="budget-remain"><span>Remaining</span><b>{money(amount)}</b></div>
    </article><article className="panel per-person"><span className="metric-icon violet"><Users size={17} /></span><h3>Per traveler</h3><p>No activities have been scheduled to estimate costs.</p></article></div>
  </section>
}

function EmptyPanel({ icon: Icon, title, text }: { icon: typeof Compass; title: string; text?: string }) {
  return <div className="empty-state"><Icon size={24} /><b>{title}</b>{text && <span>{text}</span>}</div>
}
