/**
 * 核验领域内部共享类型：把面向页面的结构化类型集中转出，并补一个最小行结构，
 * 让领域逻辑（clickchain.ts）不依赖通用 EntryRow 的 index-signature 细节。
 */
export type EntryRowLike = {
  id: number
  status?: string
  [field: string]: string | number | boolean | undefined
}

export type {
  ArbitrationMode,
  ArbitrationRecord,
  AssignedChain,
  ClickCheckResult,
  ClickEvent,
  IntegrityReport,
  MergeItem,
  SessionBoundary,
  SplitItem,
  SubmitTaskInput,
  SubmitTaskOutput,
  VerificationTask,
} from './clickverify-types'
