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

  const hasDbParts = !!(process.env.DB_HOST || process.env.POSTGRES_HOST || process.env.PGHOST)
  const hasDbUser = !!(process.env.DB_USER || process.env.POSTGRES_USER || process.env.PGUSER)

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

    process.env.DATABASE_URL = current
    return
  }

  // If individual DB parts are provided, build a Postgres URL from them
  if (hasDbParts && hasDbUser) {
  // stripQuotes already trims, so this guards against leading/trailing spaces
  const user = stripQuotes(process.env.DB_USER || process.env.POSTGRES_USER || process.env.PGUSER)
  const pass = stripQuotes(process.env.DB_PASS || process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD || '')
  const host = stripQuotes(process.env.DB_HOST || process.env.POSTGRES_HOST || process.env.PGHOST || 'localhost')
  const port = stripQuotes(process.env.DB_PORT || process.env.POSTGRES_PORT || process.env.PGPORT || '5432')
  const db = stripQuotes(process.env.DB_NAME || process.env.POSTGRES_DB || process.env.PGDATABASE || 'postgres')

    const encodedUser = encodeURIComponent(user)
    const encodedPass = encodeURIComponent(pass)

    process.env.DATABASE_URL = `postgres://${encodedUser}:${encodedPass}@${host}:${port}/${db}`
    console.log('🔧 Built DATABASE_URL from DB_* env vars')
    return
  }

  // If we reach here and there is an existing DATABASE_URL (e.g., sqlite dev file), keep it as-is
  if (current) {
    // If current is present but looks like a sqlite file or similar, just keep it
    process.env.DATABASE_URL = current
    return
  }

  // No DATABASE_URL and no DB parts: leave undefined and let Prisma fail with a helpful message later
  console.warn('⚠️ No DATABASE_URL or DB_* parts found in environment; Prisma may fail to connect')
}

export default ensureDatabaseUrl
