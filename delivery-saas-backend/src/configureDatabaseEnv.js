// Helper to normalize database environment variables.
// It will set process.env.DATABASE_URL from individual DB_* or POSTGRES_* vars
// when appropriate (for production on EasyPanel). It preserves a dev sqlite
// DATABASE_URL when NODE_ENV=development unless explicit DB_* vars are provided.

function stripQuotes(s) {
  if (!s) return s
  return s.replace(/^"|"$/g, '').replace(/^'|'$/g, '')
}

export function ensureDatabaseUrl() {
  // If DATABASE_URL exists and looks like Postgres, keep it
  const current = process.env.DATABASE_URL ? stripQuotes(process.env.DATABASE_URL) : undefined
  const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase()

  const hasDbParts = !!(process.env.DB_HOST || process.env.POSTGRES_HOST || process.env.PGHOST)
  const hasDbUser = !!(process.env.DB_USER || process.env.POSTGRES_USER || process.env.PGUSER)

  if (current && !current.startsWith('file:') && !current.startsWith('sqlite:') && !current.startsWith('file:')) {
    // already a non-sqlite DATABASE_URL
    process.env.DATABASE_URL = current
    return
  }

  // If individual DB parts are provided, build a Postgres URL from them
  if (hasDbParts && hasDbUser) {
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
    process.env.DATABASE_URL = current
    return
  }

  // No DATABASE_URL and no DB parts: leave undefined and let Prisma fail with a helpful message later
  console.warn('⚠️ No DATABASE_URL or DB_* parts found in environment; Prisma may fail to connect')
}

export default ensureDatabaseUrl
