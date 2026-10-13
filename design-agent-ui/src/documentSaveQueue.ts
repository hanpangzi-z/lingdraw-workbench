export type DocumentSaveQueueState = {
  generation: number
  revision: number
  dirty: boolean
  saving: boolean
}

export type DocumentSaveQueue<T> = {
  markDirty(value: T): number
  rebaseLatest(rebase: (value: T) => T): boolean
  flush(): Promise<void>
  reset(): number
  getState(): DocumentSaveQueueState
}

/**
 * Serializes saves for one document generation while retaining only the latest
 * dirty value. Resetting starts a new generation, so late responses from the
 * previous document cannot clear or otherwise advance the new document state.
 */
export function createDocumentSaveQueue<T>(save: (value: T) => Promise<unknown>): DocumentSaveQueue<T> {
  let generation = 0
  let revision = 0
  let latest: T | undefined
  let dirty = false
  let active: { generation: number; promise: Promise<void> } | null = null

  const getState = (): DocumentSaveQueueState => ({
    generation,
    revision,
    dirty,
    saving: active?.generation === generation,
  })

  const markDirty = (value: T) => {
    latest = value
    dirty = true
    revision += 1
    return revision
  }

  const rebaseLatest = (rebase: (value: T) => T) => {
    if (latest === undefined) return false
    const next = rebase(latest)
    if (Object.is(next, latest)) return false
    latest = next
    dirty = true
    revision += 1
    return true
  }

  const flush = (): Promise<void> => {
    const flushGeneration = generation
    if (active?.generation === flushGeneration) return active.promise
    if (!dirty || latest === undefined) return Promise.resolve()

    const drain = async () => {
      while (generation === flushGeneration && dirty && latest !== undefined) {
        const value = latest
        const savingRevision = revision
        try {
          await save(value)
        } catch (error) {
          if (generation !== flushGeneration) return
          dirty = true
          throw error
        }

        if (generation !== flushGeneration) return
        if (revision === savingRevision) dirty = false
      }
    }

    const promise = drain().finally(() => {
      if (active?.generation === flushGeneration && active.promise === promise) {
        active = null
      }
    })
    active = { generation: flushGeneration, promise }
    return promise
  }

  const reset = () => {
    generation += 1
    revision = 0
    latest = undefined
    dirty = false
    if (active?.generation !== generation) active = null
    return generation
  }

  return { markDirty, rebaseLatest, flush, reset, getState }
}
