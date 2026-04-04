/**
 * Native background GPS tracking via Capacitor.
 *
 * When running inside Capacitor (Android app), uses @capacitor-community/background-geolocation
 * which keeps a Foreground Service alive with a persistent notification.
 * When running in a regular browser, this module is a no-op.
 *
 * The plugin is accessed via Capacitor.Plugins (injected at runtime by Capacitor),
 * so there is NO npm import — this avoids Vite/Rollup build failures in the web build.
 */

let watcherId = null

/**
 * Check if we're running inside a Capacitor native app
 */
export function isNativeApp() {
  return typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isNativePlatform()
}

/**
 * Get the BackgroundGeolocation plugin from Capacitor's runtime registry.
 */
function getPlugin() {
  try {
    return window.Capacitor.Plugins.BackgroundGeolocation
  } catch (e) {
    return null
  }
}

/**
 * Start native background GPS tracking.
 * Calls onPosition(lat, lng, heading, accuracy) on each update.
 * Returns true if native tracking started, false if not available.
 */
export async function startNativeTracking(onPosition) {
  if (!isNativeApp()) return false

  const plugin = getPlugin()
  if (!plugin) {
    console.warn('[nativeTracking] BackgroundGeolocation plugin not available')
    return false
  }

  try {
    watcherId = await plugin.addWatcher(
      {
        backgroundMessage: 'Rastreamento de entrega ativo',
        backgroundTitle: 'Core Delivery',
        requestPermissions: true,
        stale: false,
        distanceFilter: 10,
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

  const plugin = getPlugin()
  if (!plugin) return

  try {
    await plugin.removeWatcher({ id: watcherId })
    watcherId = null
    console.log('[nativeTracking] Background GPS stopped')
  } catch (e) {
    console.warn('[nativeTracking] Failed to stop:', e?.message || e)
  }
}
