import type {
  ArbitrationRecord,
  IntegrityReport,
  VerificationTask,
} from './clickverify-types'

/**
 * 核验领域的结构化持久化：与通用扁平 EntryRow（local-store.ts）分开存放，
 * 因为报告要保留逐点击核验结论、仲裁清单等嵌套结构。
 *
 * 三份数据各用一个 localStorage 键：
 * - tasks   核验任务（含回冲突队列的重复任务）
 * - reports 会话点击链完整性数据报告（每个会话只允许一份有效报告）
 * - arbitrations 版本冲突仲裁记录（跨会话拆分 / 重复采集归并清单）
 */
const TASK_KEY = 'behavior-event-trace-hub:clickverify:tasks'
const REPORT_KEY = 'behavior-event-trace-hub:clickverify:reports'
const ARBITRATION_KEY = 'behavior-event-trace-hub:clickverify:arbitrations'

type StorageShape = {
  tasks: VerificationTask[]
  reports: IntegrityReport[]
  arbitrations: ArbitrationRecord[]
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function hasStorage(): boolean {
  return typeof window !== 'undefined' && !!window.localStorage
}

function read(key: string): unknown[] {
  if (!hasStorage()) {
    return []
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    return []
  }
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write(key: string, value: unknown[]): void {
  if (hasStorage()) {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
}

const memory: StorageShape = { tasks: [], reports: [], arbitrations: [] }
let hydrated = false

function hydrate(): void {
  if (hydrated) {
    return
  }
  memory.tasks = read(TASK_KEY) as VerificationTask[]
  memory.reports = read(REPORT_KEY) as IntegrityReport[]
  memory.arbitrations = read(ARBITRATION_KEY) as ArbitrationRecord[]
  hydrated = true
}

export function loadTasks(): VerificationTask[] {
  hydrate()
  return clone(memory.tasks)
}

export function saveTasks(tasks: VerificationTask[]): void {
  memory.tasks = clone(tasks)
  write(TASK_KEY, memory.tasks)
}

export function loadReports(): IntegrityReport[] {
  hydrate()
  return clone(memory.reports)
}

export function saveReports(reports: IntegrityReport[]): void {
  memory.reports = clone(reports)
  write(REPORT_KEY, memory.reports)
}

export function loadArbitrations(): ArbitrationRecord[] {
  hydrate()
  return clone(memory.arbitrations)
}

export function saveArbitrations(records: ArbitrationRecord[]): void {
  memory.arbitrations = clone(records)
  write(ARBITRATION_KEY, memory.arbitrations)
}

/** 清空核验领域数据（页面上的「重置演示数据」会调用）。 */
export function resetClickverifyStorage(): void {
  memory.tasks = []
  memory.reports = []
  memory.arbitrations = []
  write(TASK_KEY, [])
  write(REPORT_KEY, [])
  write(ARBITRATION_KEY, [])
}

export function clickverifyStorageKeys(): string[] {
  return [TASK_KEY, REPORT_KEY, ARBITRATION_KEY]
}
