import fs from 'fs'
import path from 'path'
import { enrichOrderForAgent } from './enrichOrderForAgent.js'

const QUEUE_FILE = path.join(process.cwd(), 'tmp', 'print-queue.json')

let queue = []

// Cache: storeId -> Set<socketId> — avoids O(n) scan of all sockets
const storeSocketIndex = new Map()

/**
 * Register a socket as serving the given storeIds.
 * Call on agent connect (after auth).
 */
export function registerAgentSocket(socket, storeIds) {
  if (!Array.isArray(storeIds)) return
  for (const sid of storeIds) {
    if (!storeSocketIndex.has(sid)) storeSocketIndex.set(sid, new Set())
    storeSocketIndex.get(sid).add(socket.id)
  }
  // clean up on disconnect
  socket.once('disconnect', () => {
    for (const sid of storeIds) {
      const set = storeSocketIndex.get(sid)
      if (set) { set.delete(socket.id); if (set.size === 0) storeSocketIndex.delete(sid) }
    }
  })
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true })
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf8')
  } catch (e) {
    console.warn('printQueue: failed to persist queue', e && e.message)
  }
}

// load persisted queue if present (best-effort)
try {
  if (fs.existsSync(QUEUE_FILE)) {
    const raw = fs.readFileSync(QUEUE_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) queue = parsed
  }
} catch (e) {
  queue = []
}

function makeId() {
  return `${Date.now()}-${Math.floor(Math.random()*1000000)}`
}

function enqueue(job) {
  const id = makeId()
  const item = Object.assign({ id, createdAt: Date.now() }, job)
  queue.push(item)
  persist()
  try {
    const sid = item.storeId || (item.order && item.order.storeId) || null;
    console.log(`printQueue.enqueue: id=${item.id} storeId=${sid} createdAt=${new Date(item.createdAt).toISOString()}`);
  } catch (e) {}
  return item
}

async function processForStores(io, storeIds = []) {
  // Attempt to deliver queued jobs for the given storeIds to connected agents (io).
  // Returns { ok: true, results: [...] }
  const results = []
  try {
    if (!Array.isArray(storeIds)) storeIds = [storeIds]
    // find candidate jobs
    const candidates = queue.filter(j => !j.delivered && (!j.storeId || storeIds.includes(j.storeId)))
    if (candidates.length > 0) console.log(`printQueue.processForStores: storeIds=${storeIds.join(',')} candidates=${candidates.length}`)
    for (const job of candidates) {
      let delivered = false
      if (io) {
          // Use index for fast lookup when job has a storeId, fallback to scan otherwise
          let sockets
          const indexedIds = job.storeId ? storeSocketIndex.get(job.storeId) : null
          if (indexedIds && indexedIds.size > 0) {
            sockets = []
            for (const sid of indexedIds) {
              const s = io.sockets.sockets.get(sid)
              if (s && s.connected) sockets.push(s)
            }
          } else {
            // Fallback: scan all sockets (only for jobs without storeId)
            sockets = Array.from(io.sockets.sockets.values()).filter(s => {
              const agentStoreIds = (s.agent && Array.isArray(s.agent.storeIds)) ? s.agent.storeIds : null;
              const hs = (s.handshake && s.handshake.auth) ? s.handshake.auth : null;
              const handshakeStoreIds = hs ? (Array.isArray(hs.storeIds) ? hs.storeIds : (hs.storeId ? [hs.storeId] : null)) : null;
              const ids = agentStoreIds || handshakeStoreIds;
              if (!ids) return false;
              return job.storeId ? ids.includes(job.storeId) : true;
            })
          }
        for (const s of sockets) {
          try {
            // Enrich order with printer settings before sending to agent
            let orderPayload = job.order || job
            try { orderPayload = await enrichOrderForAgent(orderPayload) } catch (e) { /* non-fatal */ }
            // emit 'novo-pedido' and wait for ack if possible
            await new Promise((resolve) => {
              try {
                s.timeout(10000).emit('novo-pedido', orderPayload, (...args) => { resolve(true) })
              } catch (e) {
                // best-effort emit
                try { s.emit('novo-pedido', orderPayload); } catch(_){}
                resolve(false)
              }
            })
            delivered = true
            break
          } catch (e) {
            continue
          }
        }
      }
      if (delivered) {
        job.delivered = true
        job.deliveredAt = Date.now()
        results.push({ id: job.id, ok: true })
      } else {
        results.push({ id: job.id, ok: false })
      }
    }
    // remove delivered jobs
    queue = queue.filter(j => !j.delivered)
    persist()
    return { ok: true, results }
  } catch (e) {
    return { ok: false, error: String(e && e.message) }
  }
}

export default { enqueue, processForStores }
