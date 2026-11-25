import { useState } from 'react'
import { signOut, type UserProfile } from 'deepspace'
import { LogOut, MoreHorizontal } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui'

export function accountName(user: UserProfile) {
  return user.name?.trim() || user.email || 'Traveler'
}

export function AccountAvatar({ user, className = '' }: { user: UserProfile; className?: string }) {
  const initials = accountName(user).split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join('').toUpperCase()
  return <Avatar className={'profile-avatar ' + className}>
    <AvatarImage src={user.imageUrl} referrerPolicy="no-referrer" />
    <AvatarFallback>{initials}</AvatarFallback>
  </Avatar>
}

export function WayviaAccount({ user, sidebar = false }: { user: UserProfile; sidebar?: boolean }) {
  const [error, setError] = useState('')
  return <>
    <DropdownMenu>
      <DropdownMenuTrigger render={<button aria-label={sidebar ? 'Workspace account menu' : 'Account menu'}
        className={sidebar ? 'profile-card account-trigger' : 'account-trigger top-avatar'} />}>
        <AccountAvatar user={user} />
        {sidebar && <><span><b data-testid="nav-user-name">{accountName(user)}</b><small>Personal account</small></span><MoreHorizontal size={17} /></>}
      </DropdownMenuTrigger>
      <DropdownMenuContent side={sidebar ? 'top' : 'bottom'} align={sidebar ? 'start' : 'end'} className="wayvia-account-popup">
        <div className="wayvia-account-details"><b>{accountName(user)}</b><span data-testid="nav-user-email">{user.email}</span></div>
        <DropdownMenuItem onClick={async () => {
          setError('')
          try { await signOut() } catch { setError('Could not sign out. Try again.') }
        }}><LogOut size={16} /> Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {error && <p className="form-error" role="alert">{error}</p>}
  </>
}
