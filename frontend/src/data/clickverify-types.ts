/**
 * 会话点击链完整性核验领域的结构化类型。
 *
 * 与通用 EntryRow（local-store 里的扁平行）不同，核验需要保留逐点击的来源页面、
 * 核验结论和仲裁去向，所以这里单独建一套结构化模型；服务层会同时把可列表化的
 * 摘要写回 clickverify 模块的 EntryRow，供概览页和通用清单复用。
 */

/** 单条点击事件：点击流侧的最小溯源单元。 */
export type ClickEvent = {
  /** 点击唯一编号，跨批次可重复（重复采集时同一编号会再次出现）。 */
  clickCode: string
  /** 该点击发生的来源页面，用于回到来源页面核验入口。 */
  sourcePage: string
  /** 点击的页面元素。 */
  element: string
  /** 发生时间（ISO 本地时间串）。 */
  eventTime: string
  /** 采集批次号：同一批次内编号唯一，跨批次可能重复采集。 */
  batchNo: string
  /** 所属点击序列编号（点击流业务面）。 */
  sequenceCode: string
}

/** 单条点击的核验结果：必须能回到来源页面核验现有入口能否形成稳定业务结果。 */
export type ClickCheckResult = {
  clickCode: string
  sourcePage: string
  element: string
  eventTime: string
  sequenceCode: string
  /** 通过 | 入口缺失 | 断链 | 重复采集 */
  result: '通过' | '入口缺失' | '断链' | '重复采集'
  /** 不通过时的说明，指向来源页面上的具体异常。 */
  reason: string
  /** 异常来源定位：来源页面 + 点击序列 + 点击下标，点击流侧据此找到异常来源。 */
  sourceEntry: {
    page: string
    sequenceCode: string
    clickIndex: number
  } | null
}

/** 会话时间边界。 */
export type SessionBoundary = {
  sessionCode: string
  startTime: string
  endTime: string
  pages: string[]
}

/** 一条已确认会话点击链（仲裁产物）：每条点击只归入一个已确认会话，不能被打破。 */
export type AssignedChain = {
  sessionCode: string
  clickCodes: string[]
}

/** 按会话时间边界重组后留下的跨会话拆分清单条目。 */
export type SplitItem = {
  clickCode: string
  eventTime: string
  fromSession: string
  toSession: string
  reason: string
}

/** 按采集批次边界重组后留下的重复采集归并清单条目。 */
export type MergeItem = {
  clickCode: string
  keptBatch: string
  droppedBatches: string[]
  mergedIntoSession: string
  reason: string
}

export type ArbitrationMode = '会话时间边界' | '采集批次边界'

/** 仲裁任务及其产物。 */
export type ArbitrationRecord = {
  id: number
  windowStart: string
  windowEnd: string
  mode: ArbitrationMode
  sessionCodes: string[]
  chains: AssignedChain[]
  splitList: SplitItem[]
  mergeList: MergeItem[]
  createdAt: string
}

/** 核验任务（待处理读取的会话记录 + 点击序列）。 */
export type VerificationTask = {
  id: number
  taskCode: string
  sessionCode: string
  sequenceCode: string
  /** 核验窗口起止。 */
  windowStart: string
  windowEnd: string
  /** 场景：完整提交 / 重复提交 / 相邻会话。 */
  scenario: string
  status: '待处理' | '已核验' | '冲突'
  createdAt: string
  /** 冲突时指向的原报告编号。 */
  conflictReportCode?: string
  conflictReason?: string
  /** 产出的报告编号。 */
  reportCode?: string
}

/** 会话点击链完整性数据报告。 */
export type IntegrityReport = {
  id: number
  reportCode: string
  sessionCode: string
  sequenceCode: string
  windowStart: string
  windowEnd: string
  status: '核验通过' | '核验异常' | '已归档'
  scenario: string
  totalClicks: number
  passedClicks: number
  abnormalClicks: number
  chainIntact: boolean
  /** 会话记录来源（会话重放业务面）。 */
  sessionSource: string
  /** 会话事件序列来源（点击流业务面），两个业务面在会话事件序列入口共用。 */
  eventSequenceSource: string
  sourcePageRefs: string[]
  checkResults: ClickCheckResult[]
  /** 关联的仲裁记录编号（相邻会话场景）。 */
  arbitrationId?: number
  taskCode: string
  createdAt: string
}

/** 提交核验任务的入参。 */
export type SubmitTaskInput = {
  sessionCode: string
  sequenceCode: string
  windowStart: string
  windowEnd: string
  scenario: string
  arbitrationMode?: ArbitrationMode
}

/** 提交核验任务的返回：首份生成报告，重复任务回冲突队列。 */
export type SubmitTaskOutput = {
  kind: 'generated' | 'conflict'
  message: string
  reportCode?: string
  conflictReportCode?: string
  taskCode: string
}
