import '@testing-library/jest-dom/vitest'

if (!globalThis.CSS) Object.defineProperty(globalThis, 'CSS', { value: {} })
if (!globalThis.CSS.supports) Object.defineProperty(globalThis.CSS, 'supports', { value: () => false })

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(globalThis, 'ResizeObserver', { value: TestResizeObserver })
