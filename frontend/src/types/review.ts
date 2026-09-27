import type { DecayType, Severity } from '@/types/decay'

/** 复核批次状态：open=未交卷可改，submitted=已交卷锁定 */
export type ReviewBatchStatus = 'open' | 'submitted'

/** 现场复核批次：一次出门核病害的一册 */
export interface ReviewBatch {
  id: string
  /** 批次题名，如「2026-09-27 大雄宝殿檐下复核」 */
  title: string
  /** 复核人 */
  reviewer: string
  /** 复核日期（YYYY-MM-DD） */
  reviewDate: string
  status: ReviewBatchStatus
  submittedAt: number | null
  createdAt: number
  updatedAt: number
}

/** 批次内的一条复核记录：进批次时快照原判，现场结论另记 */
export interface ReviewItem {
  id: string
  batchId: string
  decayId: string
  /** 进批次时的档案快照（原判） */
  beforeType: DecayType
  beforeSeverity: Severity
  beforeAreaCm2: number
  beforeCauseGuess: string
  /** 现场结论：空（null）表示维持原判 */
  afterType: DecayType | null
  afterSeverity: Severity | null
  /** 现场情况说明：改判时必填 */
  fieldNote: string
  createdAt: number
  updatedAt: number
}

/** 该条是否构成改判（类型或严重程度与快照不同） */
export function isReviewItemChanged(item: ReviewItem): boolean {
  return (
    (item.afterType !== null && item.afterType !== item.beforeType) ||
    (item.afterSeverity !== null && item.afterSeverity !== item.beforeSeverity)
  )
}

/** 交卷校验：改判的条目必须写清现场情况，返回未填说明的条目 */
export function findItemsMissingNote(items: ReviewItem[]): ReviewItem[] {
  return items.filter((item) => isReviewItemChanged(item) && item.fieldNote.trim().length === 0)
}

/** 批次统计：条目数与改判数 */
export function summarizeItems(items: ReviewItem[]): { total: number; changed: number } {
  return {
    total: items.length,
    changed: items.filter(isReviewItemChanged).length
  }
}
