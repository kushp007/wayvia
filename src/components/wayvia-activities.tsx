import { useState, type FormEvent } from 'react'
import { ArrowUp, CalendarDays, Lightbulb, MapPin, Pencil, Plus, Trash2 } from 'lucide-react'
import { categories, itinerary, type Activity, type ActivityInput } from '@/lib/collaboration'
import { formatTripDate, type TripRecord } from '@/lib/trips'
import { useTripCommand } from '@/lib/use-trip-command'
import { WayviaDialog } from './wayvia-trip-dialog'

export const money = (value: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
  maximumFractionDigits: 2,
}).format(value)

export type ActivityDialogState = { action: 'create'; date?: string; draft?: Partial<ActivityInput> } | { action: 'edit' | 'delete' | 'schedule'; activity: Activity }
type OpenActivity = (state: ActivityDialogState) => void

export function activityTime(time: string) {
  if (!time) return 'Any time'
  const [hour, minute] = time.split(':').map(Number)
  return (hour % 12 || 12) + ':' + String(minute).padStart(2, '0') + (hour < 12 ? ' AM' : ' PM')
}

export function ActivityDialog({ state, recordId, trip, close }: { state: ActivityDialogState; recordId: string; trip: TripRecord; close: () => void }) {
  const { action } = state
  const activity = 'activity' in state ? state.activity : undefined
  const draft = state.action === 'create' ? state.draft : undefined
  const initial = activity ?? draft
  const { run, pending, error } = useTripCommand()
  const showDetails = action === 'create' || action === 'edit'
  const showSchedule = action === 'create' || action === 'schedule'
  const title = { create: 'Add an activity', edit: 'Edit activity', schedule: 'Schedule activity', delete: 'Delete activity' }[action]

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const text = (name: string) => String(values.get(name) ?? '')
    const details = {
      ...(showDetails ? {
        title: text('title'), description: text('description'), category: text('category'),
        location: text('location'), cost: Number(text('cost')), duration: Number(text('duration')),
        source: text('source'), image: initial?.image ?? '',
      } : {}),
      ...(showSchedule ? { date: text('date'), time: text('time') } : {}),
    }
    void run('activity-' + action, { recordId, activityId: activity?.id, details }, close)
  }

  return <WayviaDialog title={title} busy={pending} close={close}>
    <form className="dialog-form" onSubmit={submit}>
      {action === 'delete' && <p className="dialog-intro">Delete <strong>{activity?.title}</strong> and its votes from this trip?</p>}
      {showDetails && <>
        <label>Activity name<input name="title" defaultValue={initial?.title} required maxLength={120} /></label>
        <div className="form-two">
          <label>Category<select name="category" defaultValue={initial?.category ?? categories[0]}>{categories.map(category => <option key={category}>{category}</option>)}</select></label>
          <label>Location<input name="location" defaultValue={initial?.location} maxLength={180} /></label>
        </div>
        <label>Description<textarea name="description" defaultValue={initial?.description} rows={2} maxLength={600} /></label>
        <div className="form-two">
          <label>Estimated group cost (USD)<input name="cost" type="number" min="0" max="1000000" step="0.01" required defaultValue={initial?.cost ?? (draft ? undefined : 0)} /></label>
          <label>Duration (minutes)<input name="duration" type="number" min="0" max="1440" defaultValue={initial?.duration ?? 0} /></label>
        </div>
        <label>Source URL<input name="source" type="url" defaultValue={initial?.source} maxLength={512} /></label>
      </>}
      {showSchedule && <>
        <div className="form-two">
          <label>Itinerary date<input type="date" name="date" min={trip.startDate} max={trip.endDate} defaultValue={initial?.date ?? (state.action === 'create' ? state.date : undefined)} /></label>
          <label>Time at destination<input type="time" name="time" defaultValue={activity?.time} /></label>
        </div>
        <p className="dialog-intro">Leave the date and time blank to keep this on the idea board only.</p>
      </>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="button-outline" onClick={close} disabled={pending}>Cancel</button>
        {action === 'schedule' && activity?.date && <button type="button" className="button-outline" disabled={pending} onClick={() => void run('activity-schedule', { recordId, activityId: activity.id, details: { date: '', time: '' } }, close)}>Remove from itinerary</button>}
        <button type="submit" className={action === 'delete' ? 'button-outline danger-text' : 'button-primary'} disabled={pending}>{pending ? 'Saving…' : action === 'delete' ? 'Delete activity' : 'Save activity'}</button>
      </div>
    </form>
  </WayviaDialog>
}

function ActivityControls({ activity, edit, open }: { activity: Activity; edit: boolean; open: OpenActivity }) {
  return <div className="wayvia-button-row">
    <button className="button-outline small-button" onClick={() => open({ action: 'schedule', activity })}>
      <CalendarDays size={14} /> {activity.date ? 'Change schedule' : 'Schedule'}
    </button>
    {edit && <>
      <button className="icon-button" aria-label={'Edit ' + activity.title} onClick={() => open({ action: 'edit', activity })}><Pencil size={15} /></button>
      <button className="icon-button danger-text" aria-label={'Delete ' + activity.title} onClick={() => open({ action: 'delete', activity })}><Trash2 size={15} /></button>
    </>}
  </div>
}

function ActivityCard({ activity, recordId, userId, owner, open }: { activity: Activity; recordId: string; userId: string; owner: boolean; open: OpenActivity }) {
  const { run, pending, error } = useTripCommand()
  const voted = activity.votes.includes(userId)
  return <article className="activity-card wayvia-activity">
    {activity.image && <img className="activity-image" src={activity.image} loading="lazy" referrerPolicy="no-referrer" alt="" />}
    <div className="activity-main">
      <div className="activity-meta">
        <span className="tag">{activity.category}</span>
        {activity.date && <span className="scheduled-tag">{formatTripDate(activity.date, { month: 'short', day: 'numeric' })}</span>}
      </div>
      <h3>{activity.title}</h3>
      {!!activity.location && <p className="muted"><MapPin size={13} /> {activity.location}</p>}
      {!!activity.description && <p className="activity-description">{activity.description}</p>}
      <div className="activity-bottom"><span>{money(activity.cost)} <small>group estimate</small></span>{activity.duration > 0 && <span>{activity.duration} min</span>}
        {!!activity.source && <a className="text-link" href={activity.source} target="_blank" rel="noopener noreferrer">Source</a>}
      </div>
      <ActivityControls activity={activity} edit={owner || activity.creator === userId} open={open} />
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
    <div className="vote-rail">
      <button className={voted ? 'vote-button voted' : 'vote-button'} type="button" aria-pressed={voted}
        aria-label={'Upvote ' + activity.title} disabled={pending}
        onClick={() => void run('activity-vote', { recordId, activityId: activity.id, active: !voted })}><ArrowUp size={16} /></button>
      <strong>{activity.votes.length}</strong><small>{activity.votes.length === 1 ? 'vote' : 'votes'}</small>
    </div>
  </article>
}

export function VotingBoard({ activities, recordId, userId, owner, open }: { activities: Activity[]; recordId: string; userId: string; owner: boolean; open: OpenActivity }) {
  const [sort, setSort] = useState<'popular' | 'recent'>('popular')
  const sorted = [...activities].sort((a, b) =>
    (sort === 'popular' ? b.votes.length - a.votes.length : 0) || b.createdAt.localeCompare(a.createdAt))
  return <section className="tab-content">
    <div className="board-toolbar"><button className="button-primary" onClick={() => open({ action: 'create' })}><Plus size={15} /> Add an idea</button>
      {activities.length > 0 && <label className="wayvia-sort">Sort by <select value={sort} onChange={event => setSort(event.target.value === 'recent' ? 'recent' : 'popular')}><option value="popular">Popularity</option><option value="recent">Most recent</option></select></label>}
    </div>
    {sorted.length ? <div className="activity-list">{sorted.map(activity => <ActivityCard key={activity.id} activity={activity} recordId={recordId} userId={userId} owner={owner} open={open} />)}</div>
      : <div className="empty-state"><Lightbulb size={24} /><b>No ideas yet</b><span>Suggest the first thing to do on this trip.</span></div>}
  </section>
}

export function ScheduledActivities({ activities, date, userId, owner, open }: { activities: Activity[]; date: string; userId: string; owner: boolean; open: OpenActivity }) {
  const plans = itinerary(activities).filter(activity => activity.date === date)
  return <>
    {plans.length ? <div className="timeline-list">{plans.map(activity => <article key={activity.id} className="timeline-activity">
      <div className="timeline-time">{activityTime(activity.time)}</div>
      <div className="timeline-track"><span /></div>
      <div className="timeline-card">
        <div><span className="tag">{activity.category}</span><h3>{activity.title}</h3>{!!activity.location && <p>{activity.location}</p>}</div>
        <div className="timeline-cost"><b>{money(activity.cost)}</b><ActivityControls activity={activity} edit={owner || activity.creator === userId} open={open} /></div>
      </div>
    </article>)}</div> : <div className="empty-state"><CalendarDays size={24} /><b>No activities scheduled</b><span>Add an activity here or schedule one from Voting.</span></div>}
  </>
}
