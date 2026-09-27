import type { DecayType, Severity } from '@/types/decay'

/**
 * 复核批次里一条病害的现场结论。
 * 入册时快照档案原判与位置标签，之后档案再怎么变动，册子里仍看得出原来记的是什么。
 */
export interface ReviewEntry {
  decayId: string
  /** 入册时的位置快照：殿宇 / 构件（部位） / 层位 */
  label: string
  /** 入册时档案原判：病害类型 */
  beforeType: DecayType
  /** 入册时档案原判：严重程度 */
  beforeSeverity: Severity
  /** 现场改判类型，null 表示空着、维持原判 */
  newType: DecayType | null
  /** 现场改判严重程度，null 表示空着、维持原判 */
  newSeverity: Severity | null
  /** 现场情况：改判时必填，交卷后随册子留档 */
  fieldNote: string
}

export type ReviewBatchState = 'draft' | 'submitted'

/** 现场复核批次：一次外出核查挑出的若干病害单独成册，交卷后锁定 */
export interface ReviewBatch {
  id: string
  title: string
  /** 复核人 */
  reviewer: string
  /** 复核日期（yyyy-mm-dd） */
  reviewDate: string
  state: ReviewBatchState
  entries: ReviewEntry[]
  submittedAt: number | null
  createdAt: number
  updatedAt: number
}

/** 该条目是否改判（类型或严重程度任一改动） */
export function entryChanged(entry: ReviewEntry): boolean {
  return entry.newType !== null || entry.newSeverity !== null
}

/** 条目现判类型：未改判时回落到原判 */
export function entryNowType(entry: ReviewEntry): DecayType {
  return entry.newType ?? entry.beforeType
}

/** 条目现判严重程度：未改判时回落到原判 */
export function entryNowSeverity(entry: ReviewEntry): Severity {
  return entry.newSeverity ?? entry.beforeSeverity
}

/** 批次内改判条目数 */
export function changedCount(batch: ReviewBatch): number {
  return batch.entries.filter(entryChanged).length
}
