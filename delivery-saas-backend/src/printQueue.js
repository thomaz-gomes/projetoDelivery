import fs from 'fs'
import path from 'path'

const QUEUE_FILE = process.env.PRINT_QUEUE_FILE || path.join(process.cwd(), 'tmp', 'print-queue.json')

function ensureTmpDir() {
  const dir = path.dirname(QUEUE_FILE)
  try { fs.mkdirSync(dir, { recursive: true }) } catch (e) { /* ignore */ }
}

let queue = null

function load() {
  if (queue !== null) return queue
  ensureTmpDir()
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const raw = fs.readFileSync(QUEUE_FILE, 'utf8')
      queue = JSON.parse(raw || '[]') || []
    } else {
      queue = []
    }
  } catch (e) {
    console.error('Failed to load print queue file', e && e.message)
    queue = []
  }
  return queue
}

function save() {
  try {
    ensureTmpDir()
    const tmp = QUEUE_FILE + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(queue, null, 2), 'utf8')
    try { fs.renameSync(tmp, QUEUE_FILE) } catch (e) { fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf8') }
  } catch (e) {
    console.error('Failed to save print queue', e && e.message)
  }
}

function enqueue(job) {
  load()
  const entry = Object.assign({}, job, { id: `pq-${Date.now()}-${Math.floor(Math.random()*10000)}`, createdAt: Date.now() })
  queue.push(entry)
  save()
  return entry
}

function removeById(id) {
  load()
  const before = queue.length
  queue = queue.filter(q => q.id !== id)
  if (queue.length !== before) save()
}

function list() { load(); return queue.slice() }

async function processForStores(io, storeIds = []) {
  load()
  if (!io) return { ok: false, error: 'no_io' }
  const results = []
  const ACK_TIMEOUT_MS = process.env.PRINT_ACK_TIMEOUT_MS ? Number(process.env.PRINT_ACK_TIMEOUT_MS) : 10000

  for (const job of queue.slice()) {
    if (!job || !job.storeId) continue
    if (!storeIds.includes(job.storeId)) continue

    // find connected agent sockets for this storeId
    const candidates = Array.from(io.sockets.sockets.values()).filter(s => s.agent && Array.isArray(s.agent.storeIds) && s.agent.storeIds.includes(job.storeId))
    if (!candidates || candidates.length === 0) {
      results.push({ jobId: job.id, attempted: 0, ok: false, error: 'no_agent' })
      continue
    }

    // try candidates sequentially (most recent first)
    const sorted = candidates.slice().sort((a,b) => {
      const ta = (a.agent && a.agent.connectedAt) ? a.agent.connectedAt : 0
      const tb = (b.agent && b.agent.connectedAt) ? b.agent.connectedAt : 0
      return tb - ta
    })

    let success = null
    for (const s of sorted) {
      const attempt = await new Promise(resolve => {
        let resolved = false
        const timer = setTimeout(() => {
          if (!resolved) { resolved = true; resolve({ socketId: s.id, ok: false, error: 'ack_timeout' }) }
        }, ACK_TIMEOUT_MS + 1000)
        try {
          s.timeout(ACK_TIMEOUT_MS).emit('novo-pedido', job.order, (...args) => {
            if (resolved) return
            resolved = true
            clearTimeout(timer)
            resolve({ socketId: s.id, ok: true, ack: args })
          })
        } catch (e) {
          if (!resolved) { resolved = true; clearTimeout(timer); resolve({ socketId: s.id, ok: false, error: String(e && e.message) }) }
        }
      })
      results.push({ jobId: job.id, attempt: attempt })
      if (attempt && attempt.ok) { success = attempt; break }
    }

    if (success) {
      removeById(job.id)
      results.push({ jobId: job.id, removed: true, socketId: success.socketId })
      try {
        // notify frontend about successful print
        io.emit('print-result', { orderId: job.order && job.order.id, status: 'printed', socketId: success.socketId, ack: success.ack })
      } catch (e) { /* ignore */ }
    }
  }

  return { ok: true, results }
}

export default { enqueue, list, processForStores }
