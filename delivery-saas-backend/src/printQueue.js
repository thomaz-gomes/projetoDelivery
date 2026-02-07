import fs from 'fs'
import path from 'path'
import { enrichOrderForAgent } from './enrichOrderForAgent.js'

const QUEUE_FILE = path.join(process.cwd(), 'tmp', 'print-queue.json')

let queue = []

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
    try { console.log(`printQueue.processForStores: storeIds=${JSON.stringify(storeIds)} candidates=${candidates.length}`); } catch(e){}
    for (const job of candidates) {
      let delivered = false
      if (io) {
          // find agent sockets that match job.storeId. Accept either authenticated
          // agents (s.agent) or sockets that provided storeIds in handshake.auth
          const sockets = Array.from(io.sockets.sockets.values()).filter(s => {
            const agentStoreIds = (s.agent && Array.isArray(s.agent.storeIds)) ? s.agent.storeIds : null;
            const hs = (s.handshake && s.handshake.auth) ? s.handshake.auth : null;
            const handshakeStoreIds = hs ? (Array.isArray(hs.storeIds) ? hs.storeIds : (hs.storeId ? [hs.storeId] : null)) : null;
            const storeIds = agentStoreIds || handshakeStoreIds;
            if (!storeIds) return false;
            return job.storeId ? storeIds.includes(job.storeId) : true;
          })
          try {
            console.log(`printQueue.processForStores: job=${job.id} foundCandidates=${sockets.length}`);
            sockets.forEach(s => {
              try {
                const hs = (s.handshake && s.handshake.auth) ? Object.assign({}, s.handshake.auth) : null;
                if (hs && hs.token) delete hs.token;
                const agentMeta = s.agent ? { companyId: s.agent.companyId, storeIds: s.agent.storeIds } : null;
                console.log(`  candidate socket ${s.id} connected=${s.connected} agent=${agentMeta ? JSON.stringify(agentMeta) : 'null'} handshake=${hs ? JSON.stringify(hs) : 'null'}`);
              } catch (e) {}
            })
          } catch (e) {}
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
