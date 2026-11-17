/**
 * 会话点击链完整性核验的纯领域逻辑：不碰 localStorage、不碰 DOM，方便在 Node 下
 * 直接用 SESS-0002 的三种输入做核对。
 *
 * 设计要点：
 * 1. 每条点击的核验结论都能回到来源页面（sourcePage），现有入口不能形成稳定业务
 *    结果时给出入口缺失 / 断链 / 重复采集，并定位到点击流侧的序列编号与点击下标。
 * 2. 仲裁有两种做法：按会话时间边界重组（留跨会话拆分清单）、按采集批次边界重组
 *    （留重复采集归并清单）。无论哪种，每条点击只归入一个已确认会话，不能被打破。
 */
import type {
  ArbitrationMode,
  AssignedChain,
  ClickCheckResult,
  ClickEvent,
  EntryRowLike,
  MergeItem,
  SessionBoundary,
  SplitItem,
} from './clickverify-types-internal'

/** 从点击流行里的「点击明细」JSON 字段还原逐点击事件；老数据没有该字段时按空处理。 */
export function parseClickEvents(row: EntryRowLike | undefined): ClickEvent[] {
  if (!row) {
    return []
  }
  const raw = row['点击明细']
  if (typeof raw !== 'string' || raw.trim() === '') {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as ClickEvent[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** 从会话记录行里的「会话边界」JSON 字段还原会话时间边界。 */
export function parseSessionBoundary(row: EntryRowLike | undefined): SessionBoundary | null {
  if (!row) {
    return null
  }
  const raw = row['会话边界']
  if (typeof raw !== 'string' || raw.trim() === '') {
    return null
  }
  try {
    return JSON.parse(raw) as SessionBoundary
  } catch {
    return null
  }
}

/** 来源页面入口表：登记每个页面上现有的稳定入口（能形成稳定业务结果的入口）。 */
export type StableEntryTable = Record<string, string[]>

/**
 * 核验单条点击链。
 *
 * @param sequenceCode 点击流序列编号
 * @param events 该序列在核验窗口内读到的全部点击（含重复批次）
 * @param boundary 会话记录给出的时间边界与访问页面
 * @param stableEntries 来源页面的现有入口表
 */
export function verifyClickChain(
  sequenceCode: string,
  events: ClickEvent[],
  boundary: SessionBoundary,
  stableEntries: StableEntryTable,
): ClickCheckResult[] {
  const seen = new Set<string>()
  const results: ClickCheckResult[] = []

  events.forEach((event, index) => {
    const base = {
      clickCode: event.clickCode,
      sourcePage: event.sourcePage,
      element: event.element,
      eventTime: event.eventTime,
      sequenceCode,
    }
    const locate = (): ClickCheckResult['sourceEntry'] => ({
      page: event.sourcePage,
      sequenceCode,
      clickIndex: index,
    })

    // 规则一（断链优先）：来源页面不在本会话访问页面内，点击链接不上会话链。
    const pageOrder = boundary.pages
    const currentOrder = pageOrder.indexOf(event.sourcePage)
    if (currentOrder < 0) {
      results.push({
        ...base,
        result: '断链',
        reason: `来源页面「${event.sourcePage}」不在会话「${boundary.sessionCode}」的访问页面内，点击链接不上会话链`,
        sourceEntry: locate(),
      })
      return
    }

    // 规则二：来源页面上现有入口缺失，无法形成稳定业务结果。
    const entries = stableEntries[event.sourcePage]
    if (!entries || entries.length === 0) {
      results.push({
        ...base,
        result: '入口缺失',
        reason: `来源页面「${event.sourcePage}」没有可形成稳定业务结果的现有入口，点击「${event.element}」落空`,
        sourceEntry: locate(),
      })
      return
    }
    if (!entries.includes(event.element)) {
      results.push({
        ...base,
        result: '入口缺失',
        reason: `来源页面「${event.sourcePage}」现有入口不含「${event.element}」，入口与点击元素对不上`,
        sourceEntry: locate(),
      })
      return
    }

    // 规则三：重复采集——同一点击编号在窗口内被多个批次再次上报。
    if (seen.has(event.clickCode)) {
      results.push({
        ...base,
        result: '重复采集',
        reason: `点击「${event.clickCode}」在批次「${event.batchNo}」被重复采集，首次出现于更早批次`,
        sourceEntry: locate(),
      })
      return
    }
    seen.add(event.clickCode)

    // 规则四：断链——相对上一通过点击发生跨页回跳，页面次序被打破。
    const prev = results.filter((item) => item.result === '通过').at(-1)
    if (prev) {
      const prevOrder = pageOrder.indexOf(prev.sourcePage)
      if (currentOrder < prevOrder) {
        results.push({
          ...base,
          result: '断链',
          reason: `点击从「${prev.sourcePage}」回跳到「${event.sourcePage}」，页面次序被打破，点击链断裂`,
          sourceEntry: locate(),
        })
        return
      }
    }

    results.push({
      ...base,
      result: '通过',
      reason: `来源页面「${event.sourcePage}」入口「${event.element}」可形成稳定业务结果，点击链接续正常`,
      sourceEntry: null,
    })
  })

  return results
}

/** 仅保留窗口内的点击。 */
export function filterWithinWindow(events: ClickEvent[], start: string, end: string): ClickEvent[] {
  return events.filter((event) => event.eventTime >= start && event.eventTime <= end)
}

function timestamp(value: string): number {
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

/**
 * 按会话时间边界重组：每条点击按事件时间落入唯一会话；一条序列横跨相邻会话时，
 * 超出原会话边界的点击拆给相邻会话，留下跨会话拆分清单。
 *
 * @param sequenceOwner 序列编号 -> 该序列原始归属的会话编号，用于识别跨会话拆分。
 */
export function arbitrateBySessionBoundary(
  events: ClickEvent[],
  boundaries: SessionBoundary[],
  sequenceOwner: Record<string, string>,
): { chains: AssignedChain[]; splitList: SplitItem[] } {
  const ordered = [...boundaries].sort((a, b) => a.startTime.localeCompare(b.startTime))
  const buckets = new Map<string, string[]>(ordered.map((b) => [b.sessionCode, []]))
  const splitList: SplitItem[] = []
  const ownerSession = new Map<string, string>()

  for (const event of [...events].sort((a, b) => a.eventTime.localeCompare(b.eventTime))) {
    const hit = ordered.find(
      (b) => event.eventTime >= b.startTime && event.eventTime <= b.endTime,
    )
    if (!hit) {
      continue
    }
    // 每条点击只能归入一个已确认会话：编号已归过别的会话就不再移动，只登记拆分。
    const existing = ownerSession.get(event.clickCode)
    if (existing) {
      if (existing !== hit.sessionCode) {
        splitList.push({
          clickCode: event.clickCode,
          eventTime: event.eventTime,
          fromSession: existing,
          toSession: hit.sessionCode,
          reason: `点击时间落在相邻会话「${hit.sessionCode}」边界内，按会话时间边界从「${existing}」拆出，点击仍只归属一个会话`,
        })
      }
      continue
    }

    ownerSession.set(event.clickCode, hit.sessionCode)
    buckets.get(hit.sessionCode)?.push(event.clickCode)

    // 该点击所属序列原本登记在另一个会话名下，却被时间边界划进当前会话 -> 跨会话拆分。
    const origin = sequenceOwner[event.sequenceCode]
    if (origin && origin !== hit.sessionCode) {
      splitList.push({
        clickCode: event.clickCode,
        eventTime: event.eventTime,
        fromSession: origin,
        toSession: hit.sessionCode,
        reason: `序列「${event.sequenceCode}」原属会话「${origin}」，点击时间命中相邻会话「${hit.sessionCode}」，按会话时间边界拆入后者`,
      })
    }
  }

  const chains: AssignedChain[] = ordered
    .map((b) => ({ sessionCode: b.sessionCode, clickCodes: buckets.get(b.sessionCode) ?? [] }))
    .filter((chain) => chain.clickCodes.length > 0)
  return { chains, splitList: dedupe(splitList, (i) => `${i.clickCode}|${i.fromSession}|${i.toSession}`) }
}

/**
 * 按采集批次边界重组：同一点击编号被多个批次重复采集时，保留最早批次的那条，
 * 其余批次归并，留下重复采集归并清单。归并后每条点击仍只归入一个已确认会话。
 */
export function arbitrateByBatchBoundary(
  events: ClickEvent[],
  boundaries: SessionBoundary[],
): { chains: AssignedChain[]; mergeList: MergeItem[] } {
  const ordered = [...boundaries].sort((a, b) => a.startTime.localeCompare(b.startTime))
  const firstSeen = new Map<string, ClickEvent>()
  const droppedBatches = new Map<string, Set<string>>()
  const mergeList: MergeItem[] = []

  for (const event of [...events].sort((a, b) => a.eventTime.localeCompare(b.eventTime))) {
    const kept = firstSeen.get(event.clickCode)
    if (!kept) {
      firstSeen.set(event.clickCode, event)
      continue
    }
    if (event.batchNo !== kept.batchNo) {
      const set = droppedBatches.get(event.clickCode) ?? new Set<string>()
      set.add(event.batchNo)
      droppedBatches.set(event.clickCode, set)
    }
  }

  const buckets = new Map<string, string[]>(ordered.map((b) => [b.sessionCode, []]))
  for (const [clickCode, kept] of firstSeen) {
    const hit = ordered.find(
      (b) => kept.eventTime >= b.startTime && kept.eventTime <= b.endTime,
    )
    const target = hit?.sessionCode ?? ordered[ordered.length - 1]?.sessionCode
    if (target) {
      buckets.get(target)?.push(clickCode)
    }
    const dropped = [...(droppedBatches.get(clickCode) ?? [])]
    if (dropped.length > 0) {
      mergeList.push({
        clickCode,
        keptBatch: kept.batchNo,
        droppedBatches: dropped,
        mergedIntoSession: target ?? '',
        reason: `点击在批次「${dropped.join('、')}」重复采集，按采集批次边界归并保留「${kept.batchNo}」，只归入会话「${target ?? ''}」`,
      })
    }
  }

  const chains: AssignedChain[] = ordered
    .map((b) => ({ sessionCode: b.sessionCode, clickCodes: buckets.get(b.sessionCode) ?? [] }))
    .filter((chain) => chain.clickCodes.length > 0)
  return { chains, mergeList }
}

/** 仲裁入口：按模式分派，统一保证每条点击只归入一个已确认会话。 */
export function arbitrate(
  mode: ArbitrationMode,
  events: ClickEvent[],
  boundaries: SessionBoundary[],
  sequenceOwner: Record<string, string> = {},
): { chains: AssignedChain[]; splitList: SplitItem[]; mergeList: MergeItem[] } {
  if (mode === '采集批次边界') {
    const { chains, mergeList } = arbitrateByBatchBoundary(events, boundaries)
    return { chains, splitList: [], mergeList }
  }
  const { chains, splitList } = arbitrateBySessionBoundary(events, boundaries, sequenceOwner)
  return { chains, splitList, mergeList: [] }
}

/** 仲裁不变量：所有链上的点击编号去重后必须等于输入点击去重后的全集，且无重复归属。 */
export function assertSingleAssignment(events: ClickEvent[], chains: AssignedChain[]): boolean {
  const assigned = chains.flatMap((chain) => chain.clickCodes)
  const uniqueAssigned = new Set(assigned)
  if (uniqueAssigned.size !== assigned.length) {
    return false
  }
  const expected = new Set(events.map((event) => event.clickCode))
  if (uniqueAssigned.size !== expected.size) {
    return false
  }
  return [...expected].every((code) => uniqueAssigned.has(code))
}

/** 汇总核验结论。 */
export function summarizeChecks(checks: ClickCheckResult[]): {
  total: number
  passed: number
  abnormal: number
  intact: boolean
} {
  const total = checks.length
  const passed = checks.filter((item) => item.result === '通过').length
  const abnormal = total - passed
  return { total, passed, abnormal, intact: abnormal === 0 }
}

function dedupe<T>(items: T[], keyOf: (item: T) => string): T[] {
  const map = new Map<string, T>()
  for (const item of items) {
    const key = keyOf(item)
    if (!map.has(key)) {
      map.set(key, item)
    }
  }
  return [...map.values()]
}
