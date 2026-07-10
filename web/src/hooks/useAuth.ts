import { useSyncExternalStore } from 'react'
import { getCurrentUser, isLoggedIn, subscribeAuth } from '../stores/auth'

export function useAuth() {
  const loggedIn = useSyncExternalStore(subscribeAuth, isLoggedIn, isLoggedIn)
  const user = useSyncExternalStore(subscribeAuth, getCurrentUser, getCurrentUser)
  return { loggedIn, user }
}
