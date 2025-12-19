// Helper to normalize database environment variables.
// It will set process.env.DATABASE_URL from individual DB_* or POSTGRES_* vars
// when appropriate (for production on EasyPanel). It preserves a dev sqlite
// DATABASE_URL when NODE_ENV=development unless explicit DB_* vars are provided.

function stripQuotes(s) {
  if (!s) return s
  // remove surrounding quotes and trim whitespace to guard against values like
  // ' DATABASE_URL = ... ' coming from some control panels
  return s.replace(/^"|"$/g, '').replace(/^'|'$/g, '').trim()
}

export function ensureDatabaseUrl() {
  // If DATABASE_URL exists and looks like Postgres, keep it
  const current = process.env.DATABASE_URL ? stripQuotes(process.env.DATABASE_URL) : undefined
  const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase()

  // In development prefer an existing sqlite DATABASE_URL and do not override
  // it by building a Postgres URL from DB_* parts. This allows dev to keep
  // `file:./dev.db` even when DB_* variables are present for other reasons.
  if (nodeEnv === 'development' && current && (current.startsWith('file:') || current.startsWith('sqlite:'))) {
    process.env.DATABASE_URL = current
    console.log('🔧 [dev] Keeping existing sqlite DATABASE_URL')
    return
  }

  // Normalize environment variable keys that may have accidental surrounding
  // whitespace from some control panels. For example a panel that saved
  // "DB_HOST " or " DB_NAME" will not populate process.env.DB_HOST normally.
  // Copy any such values to their trimmed key so subsequent lookups work.
  for (const k of Object.keys(process.env)) {
    const kt = k.trim()
    if (kt !== k && !Object.prototype.hasOwnProperty.call(process.env, kt)) {
      process.env[kt] = process.env[k]
      console.log(`🔁 Normalized env var key "${k}" -> "${kt}"`)
    }
  }

  const hasDbParts = !!(process.env.DB_HOST || process.env.POSTGRES_HOST || process.env.PGHOST)
  const hasDbUser = !!(process.env.DB_USER || process.env.POSTGRES_USER || process.env.PGUSER)

  // Diagnostic snapshot of important DB-related env vars (trimmed)
  const envSample = {
    DB_HOST: stripQuotes(process.env.DB_HOST || process.env.POSTGRES_HOST || process.env.PGHOST || ''),
    DB_USER: stripQuotes(process.env.DB_USER || process.env.POSTGRES_USER || process.env.PGUSER || ''),
    DB_NAME: stripQuotes(process.env.DB_NAME || process.env.POSTGRES_DB || process.env.PGDATABASE || ''),
    DB_PORT: stripQuotes(process.env.DB_PORT || process.env.POSTGRES_PORT || process.env.PGPORT || ''),
    DATABASE_URL: current || ''
  }
  // Avoid printing secrets (we intentionally don't include DB_PASS)
  console.log('🔎 DB env detection (masked):', { DB_HOST: envSample.DB_HOST || '<missing>', DB_USER: envSample.DB_USER || '<missing>', DB_NAME: envSample.DB_NAME || '<missing>', DB_PORT: envSample.DB_PORT || '<missing>' })

  if (current && !current.startsWith('file:') && !current.startsWith('sqlite:') && !current.startsWith('file:')) {
    // already a non-sqlite DATABASE_URL
    // Validate it contains an explicit database path (not just user/host)
    try {
      const u = new URL(current)
      // pathname is like '/dbname' — if missing or just '/', the DB name is not present
      if (!u.pathname || u.pathname === '/' || u.pathname.trim() === '') {
        console.warn('⚠️ DATABASE_URL found but missing database name (no path). If the DB name is omitted the client will default to the username which may be wrong.')
      }
    } catch (e) {
      // ignore parse errors; we'll still set the raw value below as a best-effort
    }

    // ensure an application_name is present so Postgres logs show which app connected
    try {
      const u = new URL(current)
      const appName = `delivery-backend-pid-${process.pid}`
      if (!u.searchParams.has('application_name')) u.searchParams.set('application_name', appName)
      process.env.DATABASE_URL = u.toString()
      console.log(`🔗 DATABASE_URL application_name set to ${appName}`)
    } catch (e) {
      process.env.DATABASE_URL = current
    }
    return
  }

  // If individual DB parts are provided, build a Postgres URL from them
  if (hasDbParts && hasDbUser) {
    // stripQuotes already trims, so this guards against leading/trailing spaces
    const user = stripQuotes(process.env.DB_USER || process.env.POSTGRES_USER || process.env.PGUSER)
    const pass = stripQuotes(process.env.DB_PASS || process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD || '')
    const host = stripQuotes(process.env.DB_HOST || process.env.POSTGRES_HOST || process.env.PGHOST || 'localhost')
    const port = stripQuotes(process.env.DB_PORT || process.env.POSTGRES_PORT || process.env.PGPORT || '5432')
    const db = stripQuotes(process.env.DB_NAME || process.env.POSTGRES_DB || process.env.PGDATABASE || '')

    const encodedUser = encodeURIComponent(user)
    const encodedPass = encodeURIComponent(pass)

    if (!db || db === '' || db === '/') {
      console.warn('⚠️ DB_NAME is empty; building a URL without a database name will make Postgres try to connect to a DB named after the user. Please set DB_NAME / POSTGRES_DB / PGDATABASE.')
    }

    // append an application_name parameter so Postgres logs include this client id
    try {
      const base = `postgres://${encodedUser}:${encodedPass}@${host}:${port}/${db || ''}`
      const appName = `delivery-backend-pid-${process.pid}`
      const urlObj = new URL(base)
      if (urlObj.search) urlObj.search += `&application_name=${encodeURIComponent(appName)}`
      else urlObj.search = `?application_name=${encodeURIComponent(appName)}`
      process.env.DATABASE_URL = urlObj.toString()
      console.log('🔧 Built DATABASE_URL from DB_* env vars (dbname:', db || '<empty>', ')', 'app:', appName + ')')
    } catch (e) {
      process.env.DATABASE_URL = `postgres://${encodedUser}:${encodedPass}@${host}:${port}/${db || ''}`
      console.log('🔧 Built DATABASE_URL from DB_* env vars (dbname:', db || '<empty>', ')')
    }
    return
  }

  // If we reach here and there is an existing DATABASE_URL (e.g., sqlite dev file), keep it as-is
  if (current) {
    // If current is present but looks like a sqlite file or similar, just keep it
    process.env.DATABASE_URL = current
    return
  }

  // Safety: in development, if DATABASE_URL is missing or malformed, prefer local sqlite file
  if (nodeEnv === 'development') {
    const devUrl = 'file:./dev.db'
    process.env.DATABASE_URL = devUrl
    console.log(`🔧 [dev] DATABASE_URL not set or non-sqlite; falling back to ${devUrl}`)
    return
  }

  // No DATABASE_URL and no DB parts: leave undefined and let Prisma fail with a helpful message later
  console.warn('⚠️ No DATABASE_URL or DB_* parts found in environment; Prisma may fail to connect')
}

export default ensureDatabaseUrl
