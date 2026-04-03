/**
 * Native background GPS tracking via Capacitor.
 *
 * When running inside Capacitor (Android app), uses @capacitor-community/background-geolocation
 * which keeps a Foreground Service alive with a persistent notification.
 * When running in a regular browser, falls back to the existing web geolocation approach.
 */

let watcherId = null

/**
 * Check if we're running inside a Capacitor native app
 */
export function isNativeApp() {
  return typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform()
}

/**
 * Start native background GPS tracking.
 * Calls onPosition(lat, lng, heading, accuracy) on each update.
 * Returns true if native tracking started, false if not available.
 */
export async function startNativeTracking(onPosition) {
  if (!isNativeApp()) return false

  try {
    const { BackgroundGeolocation } = await import('@capacitor-community/background-geolocation')

    watcherId = await BackgroundGeolocation.addWatcher(
      {
        backgroundMessage: 'Rastreamento de entrega ativo',
        backgroundTitle: 'Core Delivery',
        requestPermissions: true,
        stale: false,
        distanceFilter: 10, // meters between updates
      },
      (location, error) => {
        if (error) {
          if (error.code === 'NOT_AUTHORIZED') {
            console.warn('[nativeTracking] Location permission denied')
          }
          return
        }
        if (location) {
          onPosition(
            location.latitude,
            location.longitude,
            location.bearing ?? null,
            location.accuracy ?? null,
          )
        }
      },
    )

    console.log('[nativeTracking] Background GPS started, watcherId:', watcherId)
    return true
  } catch (e) {
    console.warn('[nativeTracking] Failed to start:', e?.message || e)
    return false
  }
}

/**
 * Stop native background GPS tracking.
 */
export async function stopNativeTracking() {
  if (watcherId === null) return

  try {
    const { BackgroundGeolocation } = await import('@capacitor-community/background-geolocation')
    await BackgroundGeolocation.removeWatcher({ id: watcherId })
    watcherId = null
    console.log('[nativeTracking] Background GPS stopped')
  } catch (e) {
    console.warn('[nativeTracking] Failed to stop:', e?.message || e)
  }
}
