/**
 * Wrapper around the BatteryOptimization Capacitor plugin (Android only).
 * When running outside Capacitor (browser), every method is a no-op.
 */

import { isNativeApp } from './nativeTracking.js'

function getPlugin() {
  try {
    return window.Capacitor.Plugins.BatteryOptimization
  } catch (e) {
    return null
  }
}

/**
 * Returns true if the app is whitelisted from Android battery optimization,
 * or true when running in the browser (no concept of battery optimization).
 */
export async function isIgnoringBatteryOptimizations() {
  if (!isNativeApp()) return true
  const plugin = getPlugin()
  if (!plugin) return true
  try {
    const { ignoring } = await plugin.isIgnoringBatteryOptimizations()
    return !!ignoring
  } catch (e) {
    console.warn('[batteryOptimization] check failed:', e?.message || e)
    return true
  }
}

/**
 * Opens the system dialog asking the user to whitelist the app
 * from battery optimization. Resolves after the user closes the dialog.
 */
export async function requestIgnoreBatteryOptimizations() {
  if (!isNativeApp()) return
  const plugin = getPlugin()
  if (!plugin) return
  try {
    await plugin.requestIgnoreBatteryOptimizations()
  } catch (e) {
    console.warn('[batteryOptimization] request failed:', e?.message || e)
  }
}

/**
 * Opens the OS app settings screen (fallback when the system dialog is unavailable
 * or the user already denied the exemption).
 */
export async function openAppSettings() {
  if (!isNativeApp()) return
  const plugin = getPlugin()
  if (!plugin) return
  try {
    await plugin.openAppSettings()
  } catch (e) {
    console.warn('[batteryOptimization] openAppSettings failed:', e?.message || e)
  }
}
