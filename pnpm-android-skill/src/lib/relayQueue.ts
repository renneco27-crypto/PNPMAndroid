// src/lib/relayQueue.ts
// In-memory thread-safe Relay Queue for StitchCSV Chrome Extension bridge

export interface RelayJob {
  id: string
  deckId: string
  prompt: string
  payload: string
  topic: string
  modelPreference?: 'flash' | 'pro'
  createdAt: number
  lastHeartbeat: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  assignedWorkerId?: string
  assignedWorkerIp?: string
  claimExpiresAt?: number
  progressInfo?: string
  resultCsv?: string
  images?: Array<{ title: string; caption?: string; dataUrl: string }>
  error?: string
}

export interface WorkerInfo {
  workerId: string
  ip: string
  relaySha: string
  userAgent?: string
  lastSeen: number
  activeJobsCount: number
  completedJobsCount: number
}

interface ResolverEntry {
  resolve: (csv: string) => void
  reject: (err: Error) => void
  timer: NodeJS.Timeout
  timeoutMs: number
}

// Store in global for Next.js hot-reload persistence in dev
const globalForRelay = globalThis as unknown as {
  relayJobs?: Map<string, RelayJob>
  relayResolvers?: Map<string, ResolverEntry>
  relayWorkers?: Map<string, WorkerInfo>
}

const jobs = (globalForRelay.relayJobs = globalForRelay.relayJobs || new Map<string, RelayJob>())
const resolvers = (globalForRelay.relayResolvers = globalForRelay.relayResolvers || new Map())
const workers = (globalForRelay.relayWorkers = globalForRelay.relayWorkers || new Map())

const WORKER_TIMEOUT_MS = 15000 // 15s offline threshold
const CLAIM_LEASE_MS = 30000 // 30s lease before auto-requeue

/**
 * Re-queues any jobs whose claiming worker stalled without heartbeat
 */
export function requeueStalledJobs() {
  const now = Date.now()
  for (const job of jobs.values()) {
    if (job.status === 'processing' && job.claimExpiresAt && job.claimExpiresAt < now) {
      console.warn(`[relayQueue] Worker ${job.assignedWorkerId || 'unknown'} stalled. Re-queuing job ${job.id} for other PCs...`)
      job.status = 'pending'
      job.assignedWorkerId = undefined
      job.assignedWorkerIp = undefined
      job.claimExpiresAt = undefined
    }
  }
}

// Cleanup stale jobs (> 30 minutes without heartbeat) and expired workers every 30 seconds
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    requeueStalledJobs()

    for (const [id, job] of jobs.entries()) {
      const lastActivity = Math.max(job.createdAt, job.lastHeartbeat || 0)
      if (now - lastActivity > 15 * 60 * 1000 && (job.status === 'pending' || job.status === 'processing')) {
        job.status = 'failed'
        job.error = 'Job expired due to inactivity'
        const resolver = resolvers.get(id)
        if (resolver) {
          clearTimeout(resolver.timer)
          resolver.reject(new Error('Job expired due to inactivity'))
          resolvers.delete(id)
        }
      } else if (now - lastActivity > 30 * 60 * 1000) {
        jobs.delete(id)
        resolvers.delete(id)
      }
    }

    for (const [wId, w] of workers.entries()) {
      if (now - w.lastSeen > 2 * 60 * 1000) {
        workers.delete(wId)
      }
    }
  }, 30 * 1000)
}

export function registerWorkerPing(
  workerId: string,
  relaySha: string = '',
  ip: string = '127.0.0.1',
  activeJobsCount: number = 0,
  userAgent?: string
) {
  const existing = workers.get(workerId)
  workers.set(workerId, {
    workerId,
    ip,
    relaySha,
    userAgent: userAgent || existing?.userAgent,
    lastSeen: Date.now(),
    activeJobsCount,
    completedJobsCount: existing?.completedJobsCount || 0,
  })
}

export function isWorkerActive(relaySha?: string): boolean {
  const now = Date.now()
  if (relaySha) {
    for (const w of workers.values()) {
      if (w.relaySha === relaySha && now - w.lastSeen < WORKER_TIMEOUT_MS) return true
    }
    return false
  }
  for (const w of workers.values()) {
    if (now - w.lastSeen < WORKER_TIMEOUT_MS) return true
  }
  return false
}

export function getActiveWorkerCount(): number {
  const now = Date.now()
  let count = 0
  for (const w of workers.values()) {
    if (now - w.lastSeen < WORKER_TIMEOUT_MS) count++
  }
  return count
}

export function getAllActiveWorkers(): WorkerInfo[] {
  const now = Date.now()
  const active: WorkerInfo[] = []
  for (const w of workers.values()) {
    if (now - w.lastSeen < WORKER_TIMEOUT_MS) {
      active.push({ ...w })
    }
  }
  return active
}

export function enqueueRelayJob(
  prompt: string,
  payload: string,
  topic: string = 'General',
  modelPreference: 'flash' | 'pro' = 'flash',
  timeoutMs: number = 240000,
  images?: Array<{ title: string; caption?: string; dataUrl: string }>,
  deckId?: string
): { jobId: string; deckId: string; promise: Promise<string> } {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  const resolvedDeckId = deckId || `deck-csv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const now = Date.now()

  const job: RelayJob = {
    id,
    deckId: resolvedDeckId,
    prompt,
    payload,
    topic,
    modelPreference,
    createdAt: now,
    lastHeartbeat: now,
    status: 'pending',
    images: images || [],
  }

  jobs.set(id, job)

  const promise = new Promise<string>((resolve, reject) => {
    const onTimeout = () => {
      resolvers.delete(id)
      const current = jobs.get(id)
      if (current && current.status !== 'completed') {
        current.status = 'failed'
        current.error = 'Extension relay response timed out'
      }
      reject(new Error(`Relay generation timed out after ${Math.round(timeoutMs / 1000)}s`))
    }

    const timer = setTimeout(onTimeout, timeoutMs)

    resolvers.set(id, {
      resolve: (csv: string) => {
        clearTimeout(timer)
        resolve(csv)
      },
      reject: (err: Error) => {
        clearTimeout(timer)
        reject(err)
      },
      timer,
      timeoutMs,
    })
  })

  return { jobId: id, deckId: resolvedDeckId, promise }
}

/**
 * Resets the expiration timeout dynamically whenever the extension sends a progress heartbeat
 */
export function heartbeatRelayJob(id: string, progressInfo?: string, workerId?: string): boolean {
  const job = jobs.get(id)
  if (!job || job.status === 'completed' || job.status === 'failed') {
    return false
  }

  // If workerId is provided, verify ownership
  if (workerId && job.assignedWorkerId && job.assignedWorkerId !== workerId) {
    console.warn(`[relayQueue] Heartbeat rejected: worker ${workerId} does not own job ${id} (assigned to ${job.assignedWorkerId})`)
    return false
  }

  const now = Date.now()
  job.lastHeartbeat = now
  job.claimExpiresAt = now + CLAIM_LEASE_MS
  job.status = 'processing'
  if (progressInfo) {
    job.progressInfo = progressInfo
  }

  if (workerId) {
    const w = workers.get(workerId)
    if (w) w.lastSeen = now
  }

  // Extend the resolver timeout window
  const resolver = resolvers.get(id)
  if (resolver) {
    clearTimeout(resolver.timer)
    const extendMs = Math.max(resolver.timeoutMs, 240000)
    resolver.timer = setTimeout(() => {
      resolvers.delete(id)
      if (job.status !== 'completed') {
        job.status = 'failed'
        job.error = 'Job heartbeat timed out (no updates received in 4 minutes)'
      }
      resolver.reject(new Error('Job heartbeat timed out'))
    }, extendMs)
  }

  return true
}

export function getRelayJob(id: string): RelayJob | null {
  return jobs.get(id) || null
}

/**
 * Atomically claims the next pending job for a specific worker PC.
 * Strictly assigns job.assignedWorkerId = workerId so no two PCs can ever process duplicate jobs.
 */
export function claimNextPendingJob(
  workerId: string = 'default_worker',
  ip: string = '127.0.0.1',
  activeJobsCount: number = 0
): RelayJob | null {
  requeueStalledJobs()

  for (const job of jobs.values()) {
    if (job.status === 'pending') {
      const now = Date.now()
      job.status = 'processing'
      job.assignedWorkerId = workerId
      job.assignedWorkerIp = ip
      job.lastHeartbeat = now
      job.claimExpiresAt = now + CLAIM_LEASE_MS

      const worker = workers.get(workerId)
      if (worker) {
        worker.activeJobsCount = activeJobsCount + 1
        worker.lastSeen = now
      }

      console.log(`[relayQueue] Job ${job.id} (Deck: ${job.deckId}) atomically locked to Worker: ${workerId} [IP: ${ip}]`)
      return job
    }
  }
  return null
}

export function getNextPendingJob(): RelayJob | null {
  return claimNextPendingJob('default_worker', '127.0.0.1')
}

export function getPendingJobs(limit: number = 5): RelayJob[] {
  const pending: RelayJob[] = []
  for (const job of jobs.values()) {
    if (job.status === 'pending') {
      pending.push(job)
      if (pending.length >= limit) break
    }
  }
  return pending
}

export function completeRelayJob(
  id: string,
  csvData: string,
  images?: Array<{ title: string; caption?: string; dataUrl: string }>,
  workerId?: string
): boolean {
  const job = jobs.get(id)
  if (!job) return false

  job.status = 'completed'
  job.resultCsv = csvData
  job.lastHeartbeat = Date.now()
  job.claimExpiresAt = undefined

  // Update worker completed metrics
  const effectiveWorkerId = workerId || job.assignedWorkerId
  if (effectiveWorkerId) {
    const w = workers.get(effectiveWorkerId)
    if (w) {
      w.completedJobsCount = (w.completedJobsCount || 0) + 1
      w.activeJobsCount = Math.max(0, (w.activeJobsCount || 1) - 1)
      w.lastSeen = Date.now()
    }
  }

  if (images && images.length > 0) {
    const existing = job.images || []
    const existingUrls = new Set(existing.map(img => img.dataUrl))
    const uniqueIncoming = images.filter(img => !existingUrls.has(img.dataUrl))
    job.images = [...existing, ...uniqueIncoming]
  }

  const resolver = resolvers.get(id)
  if (resolver) {
    clearTimeout(resolver.timer)
    resolver.resolve(csvData)
    resolvers.delete(id)
  }

  return true
}

export function failRelayJob(id: string, error: string, workerId?: string): boolean {
  const job = jobs.get(id)
  if (!job) return false

  job.status = 'failed'
  job.error = error
  job.lastHeartbeat = Date.now()
  job.claimExpiresAt = undefined

  const effectiveWorkerId = workerId || job.assignedWorkerId
  if (effectiveWorkerId) {
    const w = workers.get(effectiveWorkerId)
    if (w) {
      w.activeJobsCount = Math.max(0, (w.activeJobsCount || 1) - 1)
      w.lastSeen = Date.now()
    }
  }

  const resolver = resolvers.get(id)
  if (resolver) {
    clearTimeout(resolver.timer)
    resolver.reject(new Error(error))
    resolvers.delete(id)
  }

  return true
}

