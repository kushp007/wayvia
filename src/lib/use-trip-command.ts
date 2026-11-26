import { useRef, useState } from 'react'
import { tripRequest } from '@/lib/trip-client'

export function useTripCommand() {
  const locked = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function run<T>(action: string, params: Record<string, unknown>, done?: (data: T) => void) {
    if (locked.current) return
    locked.current = true
    setPending(true)
    setError('')
    try {
      const data = await tripRequest<T>(action, params)
      done?.(data)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not complete this change.')
    } finally {
      locked.current = false
      setPending(false)
    }
  }

  return { run, pending, error, setError }
}
