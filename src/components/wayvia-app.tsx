import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuthProfileReady, useQuery, type UserProfile } from 'deepspace'
import { ArrowRight, BarChart3, CalendarDays, ChevronRight, Compass, DollarSign, LayoutDashboard, Lightbulb, ListChecks, MapPin, Menu, MoreHorizontal, Plus, Sparkles, Users, Vote, X } from 'lucide-react'
import { coverImage, DAY_MS, formatTripDate, MAX_TRIP_DAYS, tripDays, TRIPS, type TripRecord } from '@/lib/trips'
import type { SavedTrip } from '@/lib/trip-client'
import { AccountAvatar, accountName, WayviaAccount } from './wayvia-account'
import { TripDialog, type TripDialogState } from './wayvia-trip-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui'
import { activityTime, ActivityDialog, money, ScheduledActivities, VotingBoard, type ActivityDialogState } from './wayvia-activities'
import { AcceptInvitation, InviteDialog, MemberStack, useTripMembers } from './wayvia-invitations'
import { forgetInvite, inviteFromHash, rememberedInvite } from '@/lib/trip-invites'
import { budgetSummary, itinerary, type MemberProfile } from '@/lib/collaboration'
import { CurrentWeather, DestinationDiscovery } from './wayvia-travel'
import { useTripCommand } from '@/lib/use-trip-command'

const tabs = [
  { label: 'Overview', icon: LayoutDashboard }, { label: 'Discover', icon: Compass },
  { label: 'Voting', icon: Vote }, { label: 'Itinerary', icon: CalendarDays },
  { label: 'Budget', icon: BarChart3 }, { label: 'AI planner', icon: Sparkles },
] as const
type TripTab = typeof tabs[number]['label']
const shortDate = { month: 'short', day: 'numeric' } as const
const longDate = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' } as const

export default function WayviaApp() {
  const { isSignedIn, user, userLoading } = useAuthProfileReady({ requireUser: true })
  if (!isSignedIn) return null
  if (!user || userLoading) return <div className="wayvia-loading" role="status">Loading your profile…</div>
  return <Workspace key={user.id} user={user} />
}

function Workspace({ user }: { user: UserProfile }) {
  const location = useLocation()
  const navigate = useNavigate()
  const invite = inviteFromHash(location.hash) ?? rememberedInvite()
  const { records: subscribed, status } = useQuery<TripRecord>(TRIPS)
  const records = useMemo(() => status === 'ready'
    ? [...subscribed].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.recordId.localeCompare(left.recordId))
    : [], [status, subscribed])
  const [selected, setSelected] = useState<string>()
  const [view, setView] = useState<'trip' | 'list'>('trip')
  const [tab, setTab] = useState<TripTab>('Overview')
  const [mobileMenu, setMobileMenu] = useState(false)
  const [dialog, setDialog] = useState<TripDialogState>()
  const [notice, setNotice] = useState('')
  const defaultTrip = records.reduce<SavedTrip | undefined>((latest, record) =>
    !latest || record.createdAt > latest.createdAt ? record : latest, undefined)
  const trip = records.find(record => record.recordId === selected) ?? defaultTrip
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

  function clearInvite() {
    forgetInvite()
    navigate({ pathname: '/home' }, { replace: true })
  }

  return <div className="app-shell" data-testid="app-navigation">
    <aside className={mobileMenu ? 'sidebar mobile-open' : 'sidebar'}>
      <div className="sidebar-brand">
        <Link className="brand workspace-brand" to="/" aria-label="Wayvia home"><span className="brand-mark"><Compass size={19} strokeWidth={1.8} /></span><span>Wayvia</span></Link>
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
    {invite && <AcceptInvitation key={invite} invite={invite} cancel={clearInvite} joined={id => {
      clearInvite()
      select(id)
      setNotice('You joined the trip.')
    }} />}
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
  const [activityDialog, setActivityDialog] = useState<ActivityDialogState>()
  const [coverNotice, setCoverNotice] = useState('')
  const [brokenCover, setBrokenCover] = useState<string>()
  const coverCommand = useTripCommand()
  const { data } = trip
  const owner = trip.createdBy === user.id
  const cover = coverImage(data.image)
  const days = tripDays(data.startDate, data.endDate)
  const { members, error: memberError } = useTripMembers(trip, user)
  const activities = data.activities ?? []
  const budget = budgetSummary(activities, data.budget ?? 0, members.length)

  return <>
    <section className="trip-hero neutral-cover">
      {cover && brokenCover !== cover && <img key={cover} className="trip-cover" src={cover} alt="" referrerPolicy="no-referrer" onError={() => setBrokenCover(cover)} />}
      <div className="hero-topline">
        <span className="eyebrow"><span className="live-dot" />TRIP WORKSPACE</span>
        {owner && <DropdownMenu>
          <DropdownMenuTrigger render={<button className="hero-more" aria-label="Trip options" />}><MoreHorizontal size={20} /></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="wayvia-account-popup">
            <DropdownMenuItem onClick={() => edit('edit')}>Edit trip details</DropdownMenuItem>
            <DropdownMenuItem disabled={coverCommand.pending} onClick={() => {
              setCoverNotice('')
              void coverCommand.run<{ updated?: boolean; status?: string; retryAfter?: number }>('cover-lookup', { recordId: trip.recordId }, result => {
                if (result.updated) setCoverNotice('Trip photo updated.')
                else if (result.status === 'pending') setCoverNotice('A photo search is already in progress. If it finds a photo, it will appear here.')
                else if (result.status === 'unavailable') setCoverNotice('Wikimedia could not supply a verified photo right now. Try again.')
                else if (result.status === 'limited') setCoverNotice('Photo search limit reached. Try again in ' + result.retryAfter + ' seconds.')
                else if (result.status === 'busy') setCoverNotice('Photo search is busy. Try again shortly.')
                else setCoverNotice('No suitable photo update was available.')
              })
            }}>{coverCommand.pending ? 'Looking for a photo…' : cover ? 'Refresh cover photo' : 'Find cover photo'}</DropdownMenuItem>
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
          <button className="button-ghost" onClick={() => setInvite(true)}><Users size={15} /> {owner ? 'Invite friends' : 'Trip travelers'}</button>
        </div>
      </div>
      <div className="hero-members"><MemberStack members={members} /><span>{members.length} {members.length === 1 ? 'traveler' : 'travelers'}</span></div>
    </section>
    {cover && brokenCover !== cover && data.coverAttribution && <p className="cover-credit">
      Photo <a href={data.coverAttribution.fileUrl} target="_blank" rel="noopener noreferrer">{data.coverAttribution.title}</a>
      {' by '}{data.coverAttribution.creator}{' · '}
      <a href={data.coverAttribution.licenseUrl} target="_blank" rel="noopener noreferrer">{data.coverAttribution.license}</a>
      {' · Cropped for display'}
    </p>}
    {(coverNotice || coverCommand.pending) && <p className="cover-credit" role="status">{coverCommand.pending ? 'Looking for a destination photo…' : coverNotice}</p>}
    {coverCommand.error && <p className="form-error" role="alert">{coverCommand.error}</p>}
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
      <div hidden={tab !== 'Overview'}><Overview trip={trip} members={members} days={days} showItinerary={() => setTab('Itinerary')} showVoting={() => setTab('Voting')} showMembers={() => setInvite(true)} /></div>
      <div hidden={tab !== 'Discover'}><DestinationDiscovery key={data.destination} trip={trip} owner={owner} open={setActivityDialog} /></div>
      {tab === 'Voting' && <VotingBoard activities={activities} recordId={trip.recordId} userId={user.id} owner={owner} open={setActivityDialog} />}
      {tab === 'Itinerary' && <Itinerary key={data.startDate + data.endDate} trip={data} days={days} userId={user.id} owner={owner} open={setActivityDialog} />}
      {tab === 'Budget' && <Budget amount={data.budget ?? 0} budget={budget} travelers={members.length} edit={owner ? () => edit('budget') : undefined} />}
      {tab === 'AI planner' && <EmptyPanel icon={Sparkles} title="AI Planner is pending" text="Use the activity board to collect ideas and add them to your itinerary." />}
    </div>
    {invite && <InviteDialog trip={trip} members={members} owner={owner} memberError={memberError} close={() => setInvite(false)} />}
    {activityDialog && <ActivityDialog state={activityDialog} recordId={trip.recordId} trip={data} close={() => setActivityDialog(undefined)} />}
  </>
}

function Overview({ trip: record, days, members, showItinerary, showVoting, showMembers }: {
  trip: SavedTrip; days: number; members: MemberProfile[]; showItinerary: () => void; showVoting: () => void; showMembers: () => void
}) {
  const trip = record.data
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const countdown = Math.max(0, (Date.parse(trip.startDate) - today) / DAY_MS)
  const activities = trip.activities ?? []
  const plans = itinerary(activities)
  const upcoming = plans.filter(activity => Date.parse(activity.date) >= today).slice(0, 3)
  const favorites = activities.filter(activity => activity.votes.length > 0)
    .sort((a, b) => b.votes.length - a.votes.length || b.createdAt.localeCompare(a.createdAt)).slice(0, 3)
  const metrics = [
    { label: 'DAYS TO GO', value: Number.isFinite(countdown) ? countdown : '—', note: 'Until departure', icon: CalendarDays, color: 'violet' },
    { label: 'ON THE ITINERARY', value: plans.length, note: days >= 1 ? 'Across ' + days + ' days' : 'No dates available', icon: ListChecks, color: 'teal' },
    { label: 'GROUP BUDGET', value: money(trip.budget ?? 0), note: 'Estimated total', icon: DollarSign, color: 'amber' },
  ]

  return <>
    <section className="metrics-grid" aria-label="Trip summary">
      {metrics.map(({ label, value, note, icon: Icon, color }) => <article className="metric-card" key={label}>
        <span className={'metric-icon ' + color}><Icon size={17} /></span><span className="metric-label">{label}</span><strong>{value}</strong><small>{note}</small>
      </article>)}
      <article className="metric-card members-metric">
        <span className="metric-icon rose"><Users size={17} /></span><span className="metric-label">YOUR CREW</span>
        <div className="metric-member-row"><strong>{members.length}</strong><MemberStack members={members} /></div>
        <button className="text-link" onClick={showMembers}>View travelers <ArrowRight size={14} /></button>
      </article>
    </section>
    <section className="overview-grid">
      <div className="panel itinerary-panel"><div className="panel-heading"><h3>Coming up</h3><button className="text-link" onClick={showItinerary}>Full itinerary <ArrowRight size={14} /></button></div>
        {upcoming.length ? <ul className="wayvia-overview-list">{upcoming.map(activity => <li key={activity.id}>
          <CalendarDays size={16} /><div><strong>{activity.title}</strong><small>{formatTripDate(activity.date, shortDate)} · {activityTime(activity.time)}</small></div>
        </li>)}</ul> : <EmptyPanel icon={CalendarDays} title="No upcoming activities" />}
      </div>
      <div className="overview-right">
        <CurrentWeather key={trip.destination} trip={record} />
        <div className="panel vote-picks"><div className="panel-heading"><h3>Group favorites</h3><button className="text-link" onClick={showVoting}>See ideas <ArrowRight size={14} /></button></div>
          {favorites.length ? <ul className="wayvia-overview-list">{favorites.map(activity => <li key={activity.id}><Lightbulb size={16} /><strong>{activity.title}</strong><small>{activity.votes.length} {activity.votes.length === 1 ? 'vote' : 'votes'}</small></li>)}</ul>
            : <p className="weather-note">No ideas have been voted on.</p>}
        </div>
      </div>
    </section>
  </>
}

function Itinerary({ trip, days, userId, owner, open }: {
  trip: TripRecord; days: number; userId: string; owner: boolean; open: (state: ActivityDialogState) => void
}) {
  const [day, setDay] = useState(0)
  const count = days >= 1 ? Math.min(days, MAX_TRIP_DAYS) : 0
  const activities = trip.activities ?? []
  const dayDate = (index: number) => new Date(Date.parse(trip.startDate) + index * DAY_MS).toISOString().slice(0, 10)
  const date = count ? dayDate(day) : ''
  return <section className="tab-content itinerary-view">
    <div className="itinerary-head"><h3>{trip.destination}</h3>
      {date && <button className="button-primary" onClick={() => open({ action: 'create', date })}><Plus size={15} /> Add activity</button>}
    </div>
    <div className="day-tabs">{Array.from({ length: count }, (_, index) => {
      const total = activities.filter(activity => activity.date === dayDate(index)).length
      return <button type="button" key={index} onClick={() => setDay(index)} aria-pressed={index === day} className={index === day ? 'day-active' : ''}>
        <span>DAY {index + 1}</span><b>{formatTripDate(trip.startDate, { ...shortDate, weekday: 'long' }, index)}</b><small>{total} {total === 1 ? 'activity' : 'activities'}</small>
      </button>
    })}</div>
    {date && <div className="day-summary"><div><CalendarDays size={15} />{formatTripDate(date, longDate)}</div></div>}
    <ScheduledActivities activities={activities} date={date} userId={userId} owner={owner} open={open} />
  </section>
}

function Budget({ amount, budget, travelers, edit }: { amount: number; budget: ReturnType<typeof budgetSummary>; travelers: number; edit?: () => void }) {
  const allocation = budget.percentage ?? 0
  return <section className="tab-content budget-view">
    <div className="budget-top-grid"><article className="panel budget-total">
      <div className="panel-heading"><h3>Trip budget</h3>{edit && <button className="text-link" onClick={edit}>Edit budget <ArrowRight size={14} /></button>}</div>
      <div className="budget-numbers"><div><span>Estimated cost of scheduled activities</span><strong>{money(budget.total)}</strong><small>Group budget target {money(amount)}</small></div>
        <div className="budget-ring" style={{ '--progress': (amount > 0 ? Math.min(allocation, 100) : budget.over ? 100 : 0) + '%' } as React.CSSProperties}>
          <div><strong>{budget.percentage === null ? '—' : allocation + '%'}</strong><span>allocated</span></div>
        </div>
      </div>
      <div className="budget-remain"><span>{budget.over ? 'Over budget' : 'Remaining'}</span><b className={budget.over ? 'danger-text' : ''}>{money(Math.abs(budget.remaining))}</b></div>
    </article><article className="panel per-person">
      <span className="metric-icon violet"><Users size={17} /></span><h3>Estimated per traveler</h3><strong>{money(budget.perTraveler)}</strong>
      <p>Scheduled activity estimates split across {travelers} {travelers === 1 ? 'traveler' : 'travelers'}.</p>
    </article></div>
    <article className="panel breakdown-panel">
      <div className="panel-heading"><h3>Estimated cost by category</h3><span className="estimate-note">Scheduled activities only</span></div>
      {budget.breakdown.map(({ category, total }) => <div className="category-row" key={category}>
        <span className="category-name"><i />{category}</span>
        <div className="category-bar"><span style={{ width: (budget.total ? total / budget.total * 100 : 0) + '%' }} /></div><b>{money(total)}</b>
      </div>)}
    </article>
  </section>
}

function EmptyPanel({ icon: Icon, title, text }: { icon: typeof Compass; title: string; text?: string }) {
  return <div className="empty-state"><Icon size={24} /><b>{title}</b>{text && <span>{text}</span>}</div>
}
