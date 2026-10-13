import { describe, expect, it, vi } from 'vitest'
import { createDocumentSaveQueue } from './documentSaveQueue'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('document save queue', () => {
  it('serializes saves and immediately persists the latest value dirtied in flight', async () => {
    const firstSave = deferred()
    const saved: number[] = []
    const save = vi.fn(async (value: number) => {
      saved.push(value)
      if (saved.length === 1) await firstSave.promise
    })
    const queue = createDocumentSaveQueue(save)

    queue.markDirty(1)
    const flushing = queue.flush()
    await vi.waitFor(() => expect(saved).toEqual([1]))

    queue.markDirty(2)
    queue.markDirty(3)
    expect(queue.flush()).toBe(flushing)
    firstSave.resolve()
    await flushing

    expect(saved).toEqual([1, 3])
    expect(queue.getState()).toMatchObject({ dirty: false, saving: false, revision: 3 })
  })

  it('keeps the latest value dirty after a failure so a later flush can retry it', async () => {
    let fail = true
    const save = vi.fn(async () => {
      if (fail) throw new Error('offline')
    })
    const queue = createDocumentSaveQueue(save)

    queue.markDirty({ version: 1 })
    await expect(queue.flush()).rejects.toThrow('offline')
    expect(queue.getState()).toMatchObject({ dirty: true, saving: false })

    fail = false
    await queue.flush()

    expect(save).toHaveBeenCalledTimes(2)
    expect(queue.getState()).toMatchObject({ dirty: false, saving: false })
  })

  it('rebases an in-flight latest value without discarding newer local fields', async () => {
    const firstSave = deferred()
    type SavedDocument = { snapshot: number; turns: string[] }
    const saved: SavedDocument[] = []
    const queue = createDocumentSaveQueue<SavedDocument>(async value => {
      saved.push(value)
      if (saved.length === 1) await firstSave.promise
    })

    queue.markDirty({ snapshot: 1, turns: ['server-old'] })
    const flushing = queue.flush()
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    queue.markDirty({ snapshot: 2, turns: ['local-new'] })
    queue.rebaseLatest(value => ({
      ...value,
      turns: [...new Set(['server-new', ...value.turns])],
    }))
    firstSave.resolve()
    await flushing

    expect(saved).toEqual([
      { snapshot: 1, turns: ['server-old'] },
      { snapshot: 2, turns: ['server-new', 'local-new'] },
    ])
  })

  it('does not let a late response from before reset clear the new generation', async () => {
    const oldSave = deferred()
    const saved: string[] = []
    const save = vi.fn(async (value: string) => {
      saved.push(value)
      if (value === 'old document') await oldSave.promise
    })
    const queue = createDocumentSaveQueue(save)

    queue.markDirty('old document')
    const oldFlush = queue.flush()
    await vi.waitFor(() => expect(saved).toEqual(['old document']))

    expect(queue.reset()).toBe(1)
    queue.markDirty('new document')
    oldSave.resolve()
    await oldFlush

    expect(queue.getState()).toMatchObject({ generation: 1, revision: 1, dirty: true, saving: false })
    await queue.flush()
    expect(saved).toEqual(['old document', 'new document'])
    expect(queue.getState()).toMatchObject({ generation: 1, dirty: false })
  })

  it('ignores a stale failure after reset without poisoning the new generation', async () => {
    const oldSave = deferred()
    const save = vi.fn(async (value: string) => {
      if (value === 'old document') await oldSave.promise
    })
    const queue = createDocumentSaveQueue(save)

    queue.markDirty('old document')
    const oldFlush = queue.flush()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))

    queue.reset()
    queue.markDirty('new document')
    oldSave.reject(new Error('stale offline error'))
    await expect(oldFlush).resolves.toBeUndefined()

    expect(queue.getState()).toMatchObject({ generation: 1, dirty: true, saving: false })
    await queue.flush()
    expect(queue.getState()).toMatchObject({ generation: 1, dirty: false })
  })
})
