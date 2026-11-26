const inviteStorageKey = 'wayvia-pending-invite'

export function inviteFromHash(hash: string) {
  const invite = new URLSearchParams(hash.slice(1)).get('invite')
  return invite && invite.length <= 193 ? invite : null
}

export function rememberInvite() {
  const invite = inviteFromHash(window.location.hash)
  if (!invite) return
  try { sessionStorage.setItem(inviteStorageKey, invite) } catch { /* Storage can be disabled by browser policy. */ }
}

export function rememberedInvite() {
  try { return sessionStorage.getItem(inviteStorageKey) } catch { return null }
}

export function forgetInvite() {
  try { sessionStorage.removeItem(inviteStorageKey) } catch { /* No stored invite to clear. */ }
}
