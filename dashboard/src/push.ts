/*
 * Web Push client helpers.
 *
 * Boundary between the browser's Push API and Akela's backend /push/*
 * endpoints. Keeps Settings.tsx uncluttered — the UI just calls these
 * functions and handles the boolean/void results.
 *
 * The flow:
 *   1. checkSupport()              — is the browser even capable?
 *   2. getServerStatus()           — is the backend configured (VAPID keys)?
 *   3. enableNotifications()       — ask permission → subscribe → POST
 *   4. sendTestNotification()      — hit /push/test
 *   5. disableNotifications()      — unsubscribe locally + DELETE server
 */

import api from './api'

export interface PushStatus {
  supported: boolean         // browser has Push API + Notification API + service worker
  serverEnabled: boolean     // backend has VAPID keys configured
  permission: NotificationPermission | 'unsupported'
  subscribed: boolean        // there's an active subscription for this browser
}

function urlBase64ToArrayBuffer(base64String: string): ArrayBuffer {
  // Returns a plain ArrayBuffer (not a Uint8Array view) so the result is
  // unambiguously a BufferSource at the TypeScript level. TS 5.7+ narrowed
  // Uint8Array's backing buffer to ArrayBufferLike (ArrayBuffer | SharedArrayBuffer),
  // which no longer satisfies pushManager.subscribe's applicationServerKey type.
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const buffer = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buffer)
  for (let i = 0; i < raw.length; ++i) view[i] = raw.charCodeAt(i)
  return buffer
}

export function checkSupport(): boolean {
  return (
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!checkSupport()) return null
  try {
    // ready resolves when a SW is both installed and active for the scope.
    return await navigator.serviceWorker.ready
  } catch {
    return null
  }
}

export async function getStatus(): Promise<PushStatus> {
  if (!checkSupport()) {
    return { supported: false, serverEnabled: false, permission: 'unsupported', subscribed: false }
  }

  // Ask the backend whether VAPID is configured. If not, we still show
  // the section but disable the toggle with a clear reason.
  let serverEnabled = false
  try {
    const r = await api.get('/push/vapid-public-key')
    serverEnabled = !!r.data?.enabled
  } catch {
    serverEnabled = false
  }

  const permission = Notification.permission
  const reg = await getRegistration()
  const sub = reg ? await reg.pushManager.getSubscription() : null

  return {
    supported: true,
    serverEnabled,
    permission,
    subscribed: !!sub,
  }
}

/**
 * Full opt-in flow: request permission, subscribe with the server's VAPID
 * public key, POST the subscription to /push/subscribe. Returns true on
 * success, false on any failure (caller decides how to surface).
 */
export async function enableNotifications(): Promise<boolean> {
  if (!checkSupport()) return false

  // 1. Request permission (if not already granted)
  let permission = Notification.permission
  if (permission === 'default') {
    permission = await Notification.requestPermission()
  }
  if (permission !== 'granted') return false

  // 2. Fetch the server's VAPID public key
  let publicKey: string | null = null
  try {
    const r = await api.get('/push/vapid-public-key')
    if (!r.data?.enabled) return false
    publicKey = r.data.public_key
  } catch {
    return false
  }
  if (!publicKey) return false

  // 3. Subscribe via the browser Push API
  const reg = await getRegistration()
  if (!reg) return false

  let subscription: PushSubscription
  try {
    // Check for existing subscription first — re-use instead of creating a new one.
    const existing = await reg.pushManager.getSubscription()
    subscription = existing || await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToArrayBuffer(publicKey),
    })
  } catch (e) {
    console.warn('[akela] push subscribe failed:', e)
    return false
  }

  // 4. Send the subscription to the backend so it can send us pushes
  try {
    const json = subscription.toJSON() as {
      endpoint: string
      keys: { p256dh: string; auth: string }
    }
    await api.post('/push/subscribe', {
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    })
    return true
  } catch (e) {
    console.warn('[akela] /push/subscribe failed:', e)
    // Clean up the client-side subscription so we don't leave a zombie.
    try { await subscription.unsubscribe() } catch {}
    return false
  }
}

/** Revokes the browser subscription and tells the backend to forget it. */
export async function disableNotifications(): Promise<boolean> {
  const reg = await getRegistration()
  if (!reg) return true   // nothing to do

  const sub = await reg.pushManager.getSubscription()
  if (!sub) return true

  try {
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint })
  } catch (e) {
    console.warn('[akela] /push/unsubscribe failed (continuing client-side):', e)
  }

  try {
    await sub.unsubscribe()
    return true
  } catch (e) {
    console.warn('[akela] browser unsubscribe failed:', e)
    return false
  }
}

export async function sendTestNotification(): Promise<boolean> {
  try {
    const r = await api.post('/push/test')
    return (r.data?.delivered ?? 0) > 0
  } catch {
    return false
  }
}
