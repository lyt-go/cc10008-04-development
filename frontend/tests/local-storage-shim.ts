/**
 * 测试专用：在 Node 下提供 window.localStorage 最小实现。
 * 必须在任何业务模块导入前求值（作为测试入口的第一个 import）。
 */
class LocalStorageShim {
  private store = new Map<string, string>()

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value))
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null
  }

  get length(): number {
    return this.store.size
  }
}

const shim = new LocalStorageShim()
;(globalThis as Record<string, unknown>).localStorage = shim
;(globalThis as Record<string, unknown>).window = { localStorage: shim }

export { shim }
