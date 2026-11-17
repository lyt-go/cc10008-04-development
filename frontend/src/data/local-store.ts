import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'behavior-event-trace-hub:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const merged = migrateStructuredFields({ ...fallback, ...parsed }, fallback)
    return merged
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

/**
 * 结构化字段迁移：老版本 localStorage 里的会话/点击流行没有「会话边界」「点击明细」
 * 等核验依赖字段。按业务主键（会话编号/序列编号）从种子数据补齐这些字段，
 * 用户已有的状态与其它字段保持不变；同时确保新增模块键存在。
 */
function migrateStructuredFields(
  stored: Record<string, EntryRow[]>,
  fallback: Record<string, EntryRow[]>,
): Record<string, EntryRow[]> {
  const backfill = (moduleKey: string, idField: string, extraFields: string[]) => {
    const storedRows = stored[moduleKey]
    const seedRows = fallback[moduleKey]
    if (!storedRows || !seedRows) {
      return
    }
    let changed = false
    const seedById = new Map(seedRows.map((row) => [String(row[idField]), row]))
    stored[moduleKey] = storedRows.map((row) => {
      if (extraFields.some((field) => row[field] !== undefined)) {
        return row
      }
      const seed = seedById.get(String(row[idField]))
      if (!seed) {
        return row
      }
      changed = true
      return { ...row, ...Object.fromEntries(extraFields.map((field) => [field, seed[field]])) }
    })
    if (changed) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
    }
  }

  backfill('session', '会话编号', ['会话边界'])
  backfill('clickstream', '序列编号', ['点击明细', '关联会话'])
  if (!stored.clickverify) {
    stored.clickverify = fallback.clickverify ?? []
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
  }
  return stored
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(forceRefresh = false): Record<string, EntryRow[]> {
  if (cache === null || forceRefresh) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
