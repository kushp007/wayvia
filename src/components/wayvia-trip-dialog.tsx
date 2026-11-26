import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { ArrowRight, X } from 'lucide-react'
import { tripBudget, tripDetails } from '@/lib/trips'
import { saveTrip, type SavedTrip, type TripOperation } from '@/lib/trip-client'

export type TripDialogState = { operation: 'create' } | { operation: Exclude<TripOperation, 'create'>; trip: SavedTrip }

export function WayviaDialog({ title, busy, close, children }: { title: string; busy?: boolean; close: () => void; children: ReactNode }) {
  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) close() }}>
    <Dialog.Portal>
      <Dialog.Backdrop className="modal-backdrop wayvia-backdrop" />
      <Dialog.Popup className="modal wayvia-popup">
        <div className="modal-head"><Dialog.Title>{title}</Dialog.Title>
          <Dialog.Close className="icon-button" aria-label="Close dialog" disabled={busy}><X size={18} /></Dialog.Close>
        </div>
        {children}
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>
}

const labels = {
  create: ['Start a new adventure', 'Create trip'],
  edit: ['Edit trip details', 'Save details'],
  budget: ['Edit group budget', 'Save budget'],
  delete: ['Delete trip', 'Delete trip'],
}

export function TripDialog({ state, close, saved }: { state: TripDialogState; close: () => void; saved: (id: string) => void }) {
  const { operation } = state
  const trip = 'trip' in state ? state.trip : undefined
  const data = trip?.data
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [title, submitLabel] = labels[operation]
  const showDetails = operation === 'create' || operation === 'edit'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (pending.current) return
    setError('')
    const values = new FormData(event.currentTarget)
    const field = (key: string) => String(values.get(key) ?? '')
    const budget = field('budget').trim() ? Number(field('budget')) : 0
    const parsed = showDetails ? tripDetails.safeParse({
      title: field('title'), destination: field('destination'), description: field('description'),
      startDate: field('startDate'), endDate: field('endDate'), budget, image: '',
      interests: field('interests').split(',').map(value => value.trim()).filter(Boolean),
    }) : tripBudget.safeParse({ budget })

    if (operation !== 'delete' && !parsed.success) {
      setError(parsed.error.issues[0].message)
      return
    }

    pending.current = true
    setBusy(true)
    try {
      saved(await saveTrip(operation, trip?.recordId, operation === 'delete' ? undefined : parsed.data))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save this change.')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return <WayviaDialog title={title} close={close} busy={busy}>
    <form className="dialog-form" onSubmit={submit}>
      {operation === 'create' && <p className="dialog-intro">Give your trip a name and choose where and when you’re going.</p>}
      {operation === 'delete' && <p className="dialog-intro">Delete <strong>{data?.title}</strong>? This permanently removes the trip.</p>}
      {showDetails && <>
        <label>Trip name<input name="title" defaultValue={data?.title} maxLength={120} required placeholder="e.g. A week in Portugal" /></label>
        <label>Destination<input name="destination" defaultValue={data?.destination} maxLength={120} required placeholder="City, region, or country" /></label>
        <div className="form-two">
          <label>Start date<input type="date" name="startDate" defaultValue={data?.startDate} required /></label>
          <label>End date<input type="date" name="endDate" defaultValue={data?.endDate} required /></label>
        </div>
        <label>Description <textarea name="description" defaultValue={data?.description} maxLength={1000} rows={2} /></label>
        <label>Interests <input name="interests" defaultValue={data?.interests?.join(', ')} placeholder="Food, hiking, museums" maxLength={500} /></label>
      </>}
      {operation !== 'delete' && <label>Estimated group budget (USD)<input name="budget" type="number" min="0" max="1000000000" step="0.01" defaultValue={data?.budget ?? 0} required /></label>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="button-outline" disabled={busy} onClick={close}>Cancel</button>
        <button type="submit" className={operation === 'delete' ? 'button-outline danger-text' : 'button-primary'} disabled={busy}>
          {busy ? 'Saving…' : submitLabel}{operation === 'create' && <ArrowRight size={15} />}
        </button>
      </div>
    </form>
  </WayviaDialog>
}
