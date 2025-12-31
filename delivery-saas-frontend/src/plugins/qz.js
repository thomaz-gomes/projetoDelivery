import { API_URL } from '../config';

// Build-time flag (Vite) to indicate QZ-enabled builds
const ENABLE_QZ = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_ENABLE_QZ)
  ? String(import.meta.env.VITE_ENABLE_QZ) === '1' || String(import.meta.env.VITE_ENABLE_QZ) === 'true'
  : false;

function getBaseApi() {
  return String(API_URL || '').replace(/\/$/, '') || ''
}

async function setupQZSecurity(qz) {
  try {
    if (!qz || !qz.security) return
    const base = getBaseApi()

    if (typeof qz.security.setCertificatePromise === 'function') {
      qz.security.setCertificatePromise(() => fetch(`${base}/qz/cert`, { credentials: 'include' }).then(r => r.text()))
    }

    if (typeof qz.security.setSignaturePromise === 'function') {
      // In local/dev environments we avoid browser-based signing (CORS
      // preflight issues). Register a no-op signer that immediately
      // resolves so QZ Tray will accept unsigned requests. If you want
      // real signing, enable a proper `/qz/sign` endpoint on the backend
      // that allows cross-origin requests.
      try {
        qz.security.setSignaturePromise(() => {
          return function(resolve) { resolve(); };
        });
      } catch (e) {
        console.warn('print plugin: could not set signature promise', e && e.message);
      }
      // Match backend signing algorithm (RSA-SHA256)
      try { if (typeof qz.security.setSignatureAlgorithm === 'function') qz.security.setSignatureAlgorithm('SHA256') } catch (_) {}
    }
  } catch (e) {
    console.warn('print plugin: setupQZSecurity failed', e?.message || e)
  }
}

// Try to initialize QZ Tray (if available in the page). Returns true if
// QZ websocket connection was established or the `qz` object is present.
export async function initQZ() {
  if (typeof window === 'undefined') return false;
  const qz = window.qz;
  if (!qz) {
    console.log('print plugin: QZ Tray not available in window');
    return false;
  }
  try {
    await setupQZSecurity(qz)
    if (qz.websocket && typeof qz.websocket.connect === 'function') {
      // Connect if not already connected
      try { if (!qz.websocket.isActive || !qz.websocket.isActive()) await qz.websocket.connect(); } catch(_) {}
      console.log('print plugin: QZ websocket connected');

      // Ensure a safe default semver exists immediately after connecting to
      // prevent QZ client internal versionCompare from accessing undefined.
      try {
        if (qz.websocket && qz.websocket.connection && !qz.websocket.connection.semver) {
          qz.websocket.connection.semver = [2,2,5,0];
          qz.websocket.connection.version = qz.websocket.connection.version || '2.2.5';
          console.debug('print plugin: applied default qz.websocket.connection.semver', qz.websocket.connection.semver);
          // attempt to refresh the real version in background
          if (qz.api && typeof qz.api.getVersion === 'function') {
            qz.api.getVersion().then(v => {
              try {
                if (v && qz.websocket && qz.websocket.connection) {
                  qz.websocket.connection.version = v;
                  const parts = String(v).toLowerCase().replace(/-rc\./g, "-rc").split(/[\\+\\.-]/g);
                  for (let i = 0; i < parts.length; i++) {
                    try { if (i === 3 && String(parts[i]).toLowerCase().indexOf('rc') === 0) { parts[i] = -parseInt(parts[i].replace(/\D/g, ''), 10); continue; } parts[i] = parseInt(parts[i]); } catch(_) {}
                  }
                  while (parts.length < 4) parts.push(0);
                  qz.websocket.connection.semver = parts;
                  console.debug('print plugin: refreshed qz.websocket.connection.semver', parts);
                }
              } catch(e) { console.warn('print plugin: error refreshing semver', e && e.message); }
            }).catch(_e => { /* ignore */ });
          }
        }
      } catch (eSem) { console.warn('print plugin: cannot set default semver', eSem && eSem.message || eSem); }

      // Defensive wrapper for qz.tools.versionCompare: if semver is missing
      // inside the QZ client, avoid throwing by returning 0 (treated as equal).
      try {
        if (qz && qz.tools && typeof qz.tools.versionCompare === 'function') {
          const _origVersionCompare = qz.tools.versionCompare.bind(qz.tools);
          qz.tools.versionCompare = function(major, minor, patch, build) {
            try {
              if (qz.websocket && qz.websocket.connection && Array.isArray(qz.websocket.connection.semver) && qz.websocket.connection.semver.length) {
                return _origVersionCompare(major, minor, patch, build);
              }
              console.warn('print plugin: qz.tools.versionCompare called but semver missing — returning 0');
              return 0;
            } catch (vcErr) {
              console.warn('print plugin: versionCompare wrapper error', vcErr && vcErr.message || vcErr);
              return 0;
            }
          };
          console.debug('print plugin: wrapped qz.tools.versionCompare for safety');
        }
      } catch (wrapErr) {
        console.warn('print plugin: could not wrap versionCompare', wrapErr && wrapErr.message || wrapErr);
      }
      return true;
    }
    // If websocket API missing but qz.api exists, consider it available
    if (qz.api && typeof qz.api.print === 'function') return true;
  } catch (e) {
    console.warn('print plugin: initQZ failed', e && e.message);
  }
  return false;
}

// Print an order using QZ Tray when available. Falls back to opening a
// print preview window or posting to `/agent-print` if QZ is not present.
export async function printComanda(order) {
  if (!order) return console.warn('print plugin: pedido indefinido');
  const base = getBaseApi();

  try {
    const res = await fetch(`${base}/qz-print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: order.id || order })
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error('print plugin: /qz-print failed', res.status, txt);
      if (ENABLE_QZ) {
        return fallbackPreview(txt || '<p>Preview unavailable</p>');
      }
      return fallbackAgentPrint(base, order);
    }
    const json = await res.json();
    const html = json && json.html ? String(json.html) : null;
    if (!html) return fallbackAgentPrint(base, order);

    if (typeof window !== 'undefined' && window.qz && (window.qz.print || (window.qz.api && window.qz.configs))) {
      try {
        await setupQZSecurity(window.qz)
        // Ensure QZ Tray has reported its version info (semver) before calling print.
        // Some QZ client logic expects `_qz.websocket.connection.semver` to exist;
        // if it's missing, request the version to populate it and avoid undefined access.
        try {
          if (window.qz && window.qz.websocket && window.qz.websocket.connection && !window.qz.websocket.connection.semver) {
            console.debug('print plugin: qz websocket semver missing, fetching version...');
            try {
              const v = await (window.qz.api && typeof window.qz.api.getVersion === 'function' ? window.qz.api.getVersion() : Promise.resolve(null));
              console.debug('print plugin: qz api.getVersion returned', v);
              // Populate websocket connection.version and semver similar to qz-tray's internal logic
              try {
                if (window.qz && window.qz.websocket && window.qz.websocket.connection) {
                  if (v) {
                    window.qz.websocket.connection.version = v;
                    const parts = String(v).toLowerCase().replace(/-rc\./g, "-rc").split(/[\\+\\.-]/g);
                    for (let i = 0; i < parts.length; i++) {
                      try {
                        if (i === 3 && String(parts[i]).toLowerCase().indexOf('rc') === 0) {
                          parts[i] = -parseInt(parts[i].replace(/\D/g, ''), 10);
                          continue;
                        }
                        parts[i] = parseInt(parts[i]);
                      } catch(_) {}
                    }
                    // ensure at least 4 elements
                    while (parts.length < 4) parts.push(0);
                    window.qz.websocket.connection.semver = parts;
                    console.debug('print plugin: qz websocket semver set to', parts);
                  }

                  // If semver still missing after attempting to fetch, set a safe default
                  if (!window.qz.websocket.connection.semver) {
                    const defaultSemver = [2,2,5,0];
                    window.qz.websocket.connection.semver = defaultSemver;
                    window.qz.websocket.connection.version = window.qz.websocket.connection.version || '2.2.5';
                    console.warn('print plugin: qz websocket.semver missing — applying default', defaultSemver);
                  }
                }
              } catch (pErr) {
                console.warn('print plugin: failed to set qz semver', pErr && pErr.message || pErr);
              }
            } catch (verErr) {
              console.warn('print plugin: qz api.getVersion failed', verErr && verErr.message || verErr);
            }
          }
        } catch (semErr) {
          console.warn('print plugin: error while ensuring qz semver', semErr && semErr.message || semErr);
        }

        // read optional printer configuration from localStorage (set via PrinterConfig UI)
        let pcfg = {};
        try { pcfg = JSON.parse(localStorage.getItem('printerConfig') || '{}') || {}; } catch(_) { pcfg = {}; }
        const printerName = pcfg.printerName || '';
        // Build config defaults accepted by QZ Tray (margins, orientation, size, units, density, copies, colorType, etc.)
        const configDefaults = {};
        if (pcfg.margins) configDefaults.margins = pcfg.margins;
        if (pcfg.orientation) configDefaults.orientation = pcfg.orientation;
        if (pcfg.size) configDefaults.size = pcfg.size;
        if (pcfg.units) configDefaults.units = pcfg.units;
        if (pcfg.density) configDefaults.density = pcfg.density;
        if (pcfg.copies) configDefaults.copies = pcfg.copies;
        if (pcfg.colorType) configDefaults.colorType = pcfg.colorType;

        const config = window.qz.configs.create(printerName, Object.keys(configDefaults).length ? configDefaults : undefined);

        // Build pixel print data for HTML rendering. Use 'pixel' type per QZ docs for HTML/PDF printing.
        const dataOptions = {};
        if (pcfg.pageWidth) dataOptions.pageWidth = pcfg.pageWidth;
        if (pcfg.pageHeight) dataOptions.pageHeight = pcfg.pageHeight;
        if (typeof pcfg.scaleContent !== 'undefined') dataOptions.scaleContent = pcfg.scaleContent;

        const data = [{ type: 'pixel', format: 'html', flavor: 'plain', data: html, options: Object.keys(dataOptions).length ? dataOptions : undefined }];

        // Prefer new promise-based API if available
        // Log the config/data we will send to QZ to aid debugging on failures
        try {
          console.debug('print plugin: QZ print config', config);
          console.debug('print plugin: QZ print data', data);

          if (typeof window.qz.print === 'function') {
            await window.qz.print(config, data);
          } else if (window.qz.api && typeof window.qz.api.print === 'function') {
            await window.qz.api.print(config, data);
          } else {
            throw new Error('no qz print API available');
          }

          console.log('print plugin: printed via QZ Tray (pixel html)');
          return true;
        } catch (innerErr) {
          // Log full error details to capture stack and any nested properties
          try { console.error('print plugin: qz.print threw', innerErr); } catch(_) {}
          try { console.error(innerErr && innerErr.stack ? innerErr.stack : innerErr); } catch(_) {}

          // Try a conservative fallback: attempt to print using the default printer
          // (empty printer name / default config). This helps determine whether the
          // failure is related to the provided `printerName`/config or the data itself.
          try {
            const fallbackConfig = window.qz.configs ? window.qz.configs.create('', undefined) : undefined;
            console.debug('print plugin: attempting fallback print with default config', fallbackConfig);
            if (fallbackConfig && window.qz.api && typeof window.qz.api.print === 'function') {
              await window.qz.api.print(fallbackConfig, data);
              console.log('print plugin: printed via QZ Tray (fallback default config)');
              return true;
            }
          } catch (fbErr) {
            try { console.error('print plugin: fallback print failed', fbErr); } catch(_) {}
          }

          // If fallback failed, rethrow to trigger preview fallback.
          throw innerErr;
        }
      } catch (e) {
        console.warn('print plugin: QZ print failed, falling back', e && e.message);
        return fallbackPreview(html);
      }
    }

    return fallbackPreview(html);
  } catch (e) {
    console.error('print plugin: unexpected error while printing', e && e.message);
    if (ENABLE_QZ) return fallbackPreview('<p>Preview unavailable</p>');
    return fallbackAgentPrint(base, order);
  }
}

async function fallbackAgentPrint(base, order) {
  try {
    const res = await fetch(`${base}/agent-print`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order })
    });
    if (res.ok) { console.log('print plugin: sent to agent-print fallback'); return true; }
  } catch (e) {}
  console.warn('print plugin: agent-print fallback failed');
  return false;
}

function fallbackPreview(html) {
  try {
    const w = window.open('', '_blank');
    if (!w) return false;
    w.document.open();
    w.document.write(html);
    w.document.close();
    return true;
  } catch (e) {
    console.warn('print plugin: preview fallback failed', e && e.message);
    return false;
  }
}

export default { initQZ, printComanda };