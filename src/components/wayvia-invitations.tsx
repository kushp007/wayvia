import { useEffect, useState } from 'react'
import { Copy, Link2, Users } from 'lucide-react'
import type { UserProfile } from 'deepspace'
import type { MemberProfile } from '@/lib/collaboration'
import { type SavedTrip, tripRequest } from '@/lib/trip-client'
import { useTripCommand } from '@/lib/use-trip-command'
import { AccountAvatar } from './wayvia-account'
import { WayviaDialog } from './wayvia-trip-dialog'

export function useTripMembers(trip: SavedTrip, user: UserProfile) {
  const { recordId, createdBy, data } = trip
  const memberKey = JSON.stringify([...new Set([createdBy, ...(data.collaborators ?? [])])])
  const [result, setResult] = useState<{ key: string; members: MemberProfile[]; error?: boolean }>()
  const key = recordId + ':' + memberKey
  useEffect(() => {
    let active = true
    tripRequest<MemberProfile[]>('members-read', { recordId }).then(members => {
      if (active) setResult({ key, members })
    }, () => {
      if (active) setResult({ key, members: [], error: true })
    })
    return () => { active = false }
  }, [key, recordId])
  const profiles = result?.key === key ? result.members : []
  const memberIds = JSON.parse(memberKey) as string[]
  return {
    error: result?.key === key && result.error,
    members: memberIds.map(id => profiles.find(member => member.id === id) ?? {
      id, owner: id === createdBy,
      name: id === user.id ? user.name || 'Traveler' : 'Traveler',
      imageUrl: id === user.id ? user.imageUrl : undefined,
    }),
  }
}

export function MemberStack({ members }: { members: MemberProfile[] }) {
  return <div className="avatar-stack" aria-label={members.map(member => member.name).join(', ')}>
    {members.slice(0, 5).map(member => <span key={member.id} title={member.name}><AccountAvatar user={{ ...member, email: '' }} /></span>)}
    {members.length > 5 && <span className="profile-avatar">+{members.length - 5}</span>}
  </div>
}

function InviteError({ error }: { error: string }) {
  return error ? <p className="form-error" role="alert">{error}</p> : null
}

export function AcceptInvitation({ invite, cancel, joined }: { invite: string; cancel: () => void; joined: (id: string) => void }) {
  const { run, pending, error } = useTripCommand()
  return <WayviaDialog title="Join a Wayvia trip" close={cancel} busy={pending}>
    <div className="invite-content">
      <p className="dialog-intro">Accept this invitation to join the trip and plan with the other travelers.</p>
      <InviteError error={error} />
      <div className="modal-actions">
        <button className="button-outline" onClick={cancel} disabled={pending}>Cancel</button>
        <button className="button-primary" disabled={pending} onClick={() => void run<{ recordId: string }>('invite-accept', { invite }, data => joined(data.recordId))}><Users size={16} /> {pending ? 'Joining…' : 'Accept invitation'}</button>
      </div>
    </div>
  </WayviaDialog>
}

export function InviteDialog({ trip, members, owner, memberError, close }: { trip: SavedTrip; members: MemberProfile[]; owner: boolean; memberError?: boolean; close: () => void }) {
  const { recordId, data } = trip
  const { run, pending, error, setError } = useTripCommand()
  const [invite, setInvite] = useState<{ url: string; expiresAt: number }>()
  const [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState<MemberProfile | 'leave'>()
  const valid = data.invitation && !data.invitation.revoked && data.invitation.expiresAt > Date.now()
  const link = valid && invite && invite.expiresAt === data.invitation?.expiresAt ? invite.url : undefined

  async function copy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setError('')
      setNotice('Invitation link copied.')
    } catch {
      setError('Could not copy automatically. Select the link and copy it manually.')
    }
  }

  return <WayviaDialog title={owner ? 'Invite friends' : 'Trip travelers'} close={close} busy={pending}>
    <div className="invite-content">
      {owner && <>
        <p className="dialog-intro">Anyone with an active link can join after signing in. Links expire after seven days. Creating a new link replaces the previous one.</p>
        {link && <div className="invite-link"><input aria-label="Invitation link" value={link} readOnly onFocus={event => event.currentTarget.select()} /><button className="button-outline small-button" onClick={() => void copy()}><Copy size={14} /> Copy link</button></div>}
        <div className="wayvia-button-row">
          <button className="button-primary" disabled={pending} onClick={() => void run<{ invite: string; expiresAt: number }>('invite-create', { recordId }, result => {
            setInvite({ url: new URL('/home#invite=' + encodeURIComponent(result.invite), window.location.origin).href, expiresAt: result.expiresAt })
            setNotice('Invitation created.')
          })}><Link2 size={15} /> {valid ? 'Replace invitation' : 'Generate invitation'}</button>
          {valid && <button className="button-outline" disabled={pending} onClick={() => void run('invite-revoke', { recordId }, () => {
            setInvite(undefined)
            setNotice('Invitation revoked.')
          })}>Revoke invitation</button>}
        </div>
      </>}
      <span className="section-kicker member-list-label">TRAVELERS · {members.length}</span>
      {memberError && <p className="form-error" role="alert">Could not load traveler profiles.</p>}
      {members.map(member => <div className="invite-member" key={member.id}>
        <AccountAvatar user={{ ...member, email: '' }} /><span><b>{member.name}</b><small>{member.owner ? 'Owner' : 'Collaborator'}</small></span>
        {owner && !member.owner && <button className="button-outline small-button" onClick={() => setConfirm(member)} disabled={pending}>Remove <span className="sr-only">{member.name}</span></button>}
      </div>)}
      {!owner && <button className="button-outline danger-text" disabled={pending} onClick={() => setConfirm('leave')}>Leave trip</button>}
      {confirm && <div className="membership-confirm">
        <p>{confirm === 'leave' ? 'Leave this trip and lose access to its plans?' : 'Remove ' + confirm.name + ' and revoke the active link?'}</p>
        <div className="wayvia-button-row">
          <button className="button-outline" disabled={pending} onClick={() => setConfirm(undefined)}>Cancel</button>
          <button className="button-outline danger-text" disabled={pending} onClick={() => void run(
            confirm === 'leave' ? 'member-leave' : 'member-remove',
            { recordId, memberId: confirm === 'leave' ? undefined : confirm.id },
            () => {
              if (confirm === 'leave') close()
              else {
                setConfirm(undefined)
                setInvite(undefined)
                setNotice('Traveler removed.')
              }
            },
          )}>{confirm === 'leave' ? 'Confirm leave' : 'Confirm removal'}</button>
        </div>
      </div>}
      <InviteError error={error} />
      {notice && <p role="status" className="permission-note">{notice}</p>}
    </div>
  </WayviaDialog>
}
