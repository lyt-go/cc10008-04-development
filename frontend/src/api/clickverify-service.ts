import {
  loadArbitrations,
  loadReports,
  loadTasks,
  saveArbitrations,
  saveReports,
  saveTasks,
} from '@/data/clickverify-store'
import {
  STABLE_ENTRY_TABLE,
  describeEventSequenceSource,
  describeSessionSource,
  findClickstreamRow,
  findSessionRow,
  readClickEvents,
  readSessionBoundary,
  refreshSourceCache,
} from '@/data/clickverify-sources'
import {
  arbitrate,
  assertSingleAssignment,
  filterWithinWindow,
  summarizeChecks,
  verifyClickChain,
} from '@/data/clickchain'
import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import type {
  ArbitrationMode,
  ArbitrationRecord,
  ClickEvent,
  IntegrityReport,
  SubmitTaskInput,
  SubmitTaskOutput,
  VerificationTask,
} from '@/data/clickverify-types'

/**
 * 会话点击链完整性核验服务。
 *
 * 并发与唯一性约束（纯前端用同步调用 + 会话级锁模拟，语义与后端单写约束一致）：
 * - 同一会话两个核验任务同时确认时，只生成一份有效报告；后到任务收到内容冲突说明
 *   和原报告编号，进冲突队列。
 * - 并发提交请求时只写入首份新生成的报告，重复任务回到冲突队列，不产生第二份报告。
 */

const MODULE_KEY = 'clickverify'
// 有效报告：已归档之外的报告都占着会话的唯一报告位。
const ACTIVE_STATUSES = ['核验通过', '核验异常']
const inFlightSessions = new Set<string>()

function nowText(): string {
  return new Date().toISOString()
}

function nextId(items: { id: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1
}

function nextCode(prefix: string, items: { reportCode?: string; taskCode?: string }[]): string {
  const max = items.reduce((acc, item) => {
    const code = item.reportCode ?? item.taskCode ?? ''
    const matched = code.match(/(\d+)$/)
    return matched ? Math.max(acc, Number(matched[1])) : acc
  }, 0)
  return `${prefix}-${String(max + 1).padStart(4, '0')}`
}

function activeReportForSession(reports: IntegrityReport[], sessionCode: string): IntegrityReport | undefined {
  return reports.find(
    (report) => report.sessionCode === sessionCode && ACTIVE_STATUSES.includes(report.status),
  )
}

/** 把结构化报告同步成 clickverify 模块的扁平清单行，概览页与通用列表直接可见。 */
function syncReportRows(reports: IntegrityReport[]): void {
  const existing = listRows(MODULE_KEY)
  const rows: EntryRow[] = reports.map((report, index) => ({
    id: report.id,
    status: report.status,
    pending: report.status !== '已归档',
    abnormal: report.abnormalClicks > 0,
    报告编号: report.reportCode,
    会话编号: report.sessionCode,
    序列编号: report.sequenceCode,
    核验窗口: `${report.windowStart} ~ ${report.windowEnd}`,
    核验结论: report.chainIntact ? '点击链完整' : `异常${report.abnormalClicks}处`,
    异常来源定位: report.checkResults
      .filter((item) => item.result !== '通过' && item.sourceEntry)
      .map((item) => `${item.sourceEntry?.page}#${item.sourceEntry?.sequenceCode}[${item.sourceEntry?.clickIndex}]`)
      .join('；') || '无',
    会话记录来源: report.sessionSource,
    会话事件序列来源: report.eventSequenceSource,
    仲裁方式: report.arbitrationId ? `仲裁单#${report.arbitrationId}` : '不涉及版本冲突',
    任务编号: report.taskCode,
    生成时间: report.createdAt,
    _order: index,
  }))
  // 保留任何不是报告镜像的历史行（当前没有，但避免覆盖未来扩展）。
  const managedIds = new Set(rows.map((row) => row.id))
  const extra = existing.filter((row) => !managedIds.has(row.id))
  saveRows(MODULE_KEY, [...rows, ...extra])
}

function buildReport(
  task: VerificationTask,
  input: SubmitTaskInput,
  events: ClickEvent[],
  arbitrationId?: number,
): IntegrityReport {
  const boundary = readSessionBoundary(input.sessionCode)
  const fallbackBoundary = boundary ?? {
    sessionCode: input.sessionCode,
    startTime: input.windowStart,
    endTime: input.windowEnd,
    pages: [...new Set(events.map((event) => event.sourcePage))],
  }
  const checks = verifyClickChain(
    input.sequenceCode,
    events,
    fallbackBoundary,
    STABLE_ENTRY_TABLE,
  )
  const summary = summarizeChecks(checks)
  const reports = loadReports()

  return {
    id: nextId(reports),
    reportCode: nextCode('CVER', reports),
    sessionCode: input.sessionCode,
    sequenceCode: input.sequenceCode,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    status: summary.intact ? '核验通过' : '核验异常',
    scenario: input.scenario,
    totalClicks: summary.total,
    passedClicks: summary.passed,
    abnormalClicks: summary.abnormal,
    chainIntact: summary.intact,
    sessionSource: describeSessionSource(input.sessionCode),
    eventSequenceSource: describeEventSequenceSource(input.sequenceCode),
    sourcePageRefs: [...new Set(checks.map((item) => item.sourcePage))],
    checkResults: checks,
    arbitrationId,
    taskCode: task.taskCode,
    createdAt: nowText(),
  }
}

/**
 * 相邻会话场景：先跑版本冲突仲裁。
 * 两种做法都支持，默认按会话时间边界；返回仲裁记录 id 写进报告。
 */
function runArbitrationIfNeeded(
  input: SubmitTaskInput,
  events: ClickEvent[],
): { arbitrationId?: number } {
  if (input.scenario !== '相邻会话') {
    return {}
  }
  const mode: ArbitrationMode = input.arbitrationMode ?? '会话时间边界'
  const primary = readSessionBoundary(input.sessionCode)
  // 相邻会话：取窗口内所有会话的边界（同用户、时间相接）。
  const neighborRows = listRows('session').filter((row) => {
    if (String(row['会话编号']) === input.sessionCode) {
      return true
    }
    return String(row['用户标识']) === String(findSessionRow(input.sessionCode)?.['用户标识'])
  })
  const boundaries = neighborRows
    .map((row) => readSessionBoundary(String(row['会话编号'])))
    .filter((item): item is NonNullable<typeof item> => item !== null)
  const baseBoundary = primary ?? {
    sessionCode: input.sessionCode,
    startTime: input.windowStart,
    endTime: input.windowEnd,
    pages: [...new Set(events.map((event) => event.sourcePage))],
  }
  const allBoundaries = boundaries.length ? boundaries : [baseBoundary]

  // 序列 -> 原会话，用于按会话时间边界识别跨会话拆分。
  const sequenceOwner: Record<string, string> = {}
  for (const row of listRows('clickstream')) {
    sequenceOwner[String(row['序列编号'])] = String(row['关联会话'] ?? input.sessionCode)
  }

  const outcome = arbitrate(mode, events, allBoundaries, sequenceOwner)
  if (!assertSingleAssignment(events, outcome.chains)) {
    throw new Error('仲裁不变量被打破：存在点击未唯一归入已确认会话')
  }

  const records = loadArbitrations()
  const record: ArbitrationRecord = {
    id: nextId(records),
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    mode,
    sessionCodes: allBoundaries.map((item) => item.sessionCode),
    chains: outcome.chains,
    splitList: outcome.splitList,
    mergeList: outcome.mergeList,
    createdAt: nowText(),
  }
  records.push(record)
  saveArbitrations(records)
  return { arbitrationId: record.id }
}

/**
 * 提交核验任务。
 * @returns generated：首份报告已写入；conflict：重复任务回冲突队列，带原报告编号。
 */
export function submitVerificationTask(input: SubmitTaskInput): SubmitTaskOutput {
  refreshSourceCache()

  // 来源核验：会话记录与点击序列必须都能回到来源页面定位。
  const sessionRow = findSessionRow(input.sessionCode)
  const clickstreamRow = findClickstreamRow(input.sequenceCode)
  if (!sessionRow) {
    return {
      kind: 'conflict',
      message: `会话记录「${input.sessionCode}」在会话重放来源中不存在，无法核验`,
      taskCode: '',
    }
  }
  if (!clickstreamRow) {
    return {
      kind: 'conflict',
      message: `点击序列「${input.sequenceCode}」在点击流来源中不存在，无法核验`,
      taskCode: '',
    }
  }

  const tasks = loadTasks()
  const reports = loadReports()

  // 并发提交：同一会话已有在途任务/有效报告时，后到者只能进冲突队列。
  const existingReport = activeReportForSession(reports, input.sessionCode)
  const concurrent = inFlightSessions.has(input.sessionCode) || Boolean(existingReport)

  const task: VerificationTask = {
    id: nextId(tasks),
    taskCode: nextCode('VTASK', tasks),
    sessionCode: input.sessionCode,
    sequenceCode: input.sequenceCode,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    scenario: input.scenario,
    status: '待处理',
    createdAt: nowText(),
  }

  if (concurrent && existingReport) {
    task.status = '冲突'
    task.conflictReportCode = existingReport.reportCode
    task.conflictReason = `内容冲突：会话「${input.sessionCode}」已存在有效报告 ${existingReport.reportCode}（${existingReport.scenario}），同一会话只保留一份有效报告`
    tasks.push(task)
    saveTasks(tasks)
    return {
      kind: 'conflict',
      message: task.conflictReason,
      conflictReportCode: existingReport.reportCode,
      taskCode: task.taskCode,
    }
  }

  // 首份任务：加会话锁，写入首份新生成的报告。
  inFlightSessions.add(input.sessionCode)
  try {
    const allEvents = readClickEvents(input.sequenceCode)
    const windowed = filterWithinWindow(allEvents, input.windowStart, input.windowEnd)
    const { arbitrationId } = runArbitrationIfNeeded(input, windowed)
    const report = buildReport(task, input, windowed, arbitrationId)

    reports.push(report)
    saveReports(reports)
    syncReportRows(reports)

    task.status = '已核验'
    task.reportCode = report.reportCode
    tasks.push(task)
    saveTasks(tasks)

    return {
      kind: 'generated',
      message: `已生成会话点击链完整性数据报告 ${report.reportCode}，核验结论：${report.chainIntact ? '点击链完整' : `存在 ${report.abnormalClicks} 处异常`}`,
      reportCode: report.reportCode,
      taskCode: task.taskCode,
    }
  } finally {
    inFlightSessions.delete(input.sessionCode)
  }
}

export function listVerificationTasks(): VerificationTask[] {
  return loadTasks()
}

export function listIntegrityReports(): IntegrityReport[] {
  return loadReports()
}

export function listArbitrations(): ArbitrationRecord[] {
  return loadArbitrations()
}

export function findReport(reportCode: string): IntegrityReport | undefined {
  return loadReports().find((report) => report.reportCode === reportCode)
}

export function findArbitration(id: number): ArbitrationRecord | undefined {
  return loadArbitrations().find((record) => record.id === id)
}

/** 点击流侧定位异常来源：按点击序列返回带 sourceEntry 的异常点击。 */
export function locateAbnormalSources(sequenceCode?: string): IntegrityReport['checkResults'] {
  const reports = loadReports()
  return reports
    .flatMap((report) => report.checkResults)
    .filter((item) => item.result !== '通过' && item.sourceEntry)
    .filter((item) => !sequenceCode || item.sequenceCode === sequenceCode)
}

/** 冲突队列：后到的重复任务。 */
export function listConflictTasks(): VerificationTask[] {
  return loadTasks().filter((task) => task.status === '冲突')
}

/** 归档报告：释放会话的有效报告位（归档报告不再阻止新报告，但报告仍可查）。 */
export function archiveReport(reportCode: string): { ok: boolean; message: string } {
  const reports = loadReports()
  const index = reports.findIndex((report) => report.reportCode === reportCode)
  if (index < 0) {
    return { ok: false, message: `没有找到报告 ${reportCode}` }
  }
  reports[index] = { ...reports[index], status: '已归档' }
  saveReports(reports)
  syncReportRows(reports)
  return { ok: true, message: `报告 ${reportCode} 已归档` }
}
