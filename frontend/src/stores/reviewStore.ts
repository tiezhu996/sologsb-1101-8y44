import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { db } from '@/utils/db'
import { useIdbTable } from '@/hooks/useIdbTable'
import type { Decay } from '@/types/decay'
import {
  findItemsMissingNote,
  isReviewItemChanged,
  type ReviewBatch,
  type ReviewItem
} from '@/types/review'

/** 交卷结果：applied=落档的改判条数，kept=维持原判条数 */
export interface SubmitResult {
  applied: number
  kept: number
}

/**
 * 现场复核批次 store：批次册子与逐条复核记录的读写。
 * 未交卷的批次随时可改；交卷时把改判落到病害档案，此后批次锁定只读。
 */
export const useReviewStore = defineStore('review', () => {
  const batchesTable = useIdbTable<ReviewBatch>((database) => database.reviewBatches)
  const itemsTable = useIdbTable<ReviewItem>((database) => database.reviewItems, { sortByUpdatedAt: false })

  /** 从病害档案台带过来的待组批病害 id，进入新建批次对话框时预勾选 */
  const draftDecayIds = ref<string[]>([])

  const batches = computed<ReviewBatch[]>(() => batchesTable.rows.value)
  const items = computed<ReviewItem[]>(() => itemsTable.rows.value)
  const openBatchCount = computed(() => batches.value.filter((batch) => batch.status === 'open').length)

  function itemsOf(batchId: string): ReviewItem[] {
    return items.value.filter((item) => item.batchId === batchId)
  }

  function batchById(id: string): ReviewBatch | undefined {
    return batches.value.find((batch) => batch.id === id)
  }

  function setDraftDecayIds(ids: string[]): void {
    draftDecayIds.value = [...ids]
  }

  function clearDraftDecayIds(): void {
    draftDecayIds.value = []
  }

  /** 新建批次：把挑中的病害当前档案值快照进册子 */
  async function createBatch(payload: {
    title: string
    reviewer: string
    reviewDate: string
    decays: Decay[]
  }): Promise<ReviewBatch> {
    const now = Date.now()
    const batch = await batchesTable.create(
      {
        title: payload.title,
        reviewer: payload.reviewer,
        reviewDate: payload.reviewDate,
        status: 'open',
        submittedAt: null
      },
      'batch'
    )
    const rows = payload.decays.map((decay) => ({
      batchId: batch.id,
      decayId: decay.id,
      beforeType: decay.type,
      beforeSeverity: decay.severity,
      beforeAreaCm2: decay.areaCm2,
      beforeCauseGuess: decay.causeGuess,
      afterType: null,
      afterSeverity: null,
      fieldNote: '',
      createdAt: now,
      updatedAt: now
    }))
    for (const row of rows) {
      await itemsTable.create(row, 'ritem')
    }
    return batch
  }

  /** 改批次题名 / 复核人 / 日期：仅未交卷可改 */
  async function updateBatch(
    id: string,
    patch: Partial<Pick<ReviewBatch, 'title' | 'reviewer' | 'reviewDate'>>
  ): Promise<void> {
    const batch = await batchesTable.getById(id)
    if (!batch || batch.status !== 'open') return
    await batchesTable.update(id, patch)
  }

  /** 写某条的现场结论：仅未交卷可改 */
  async function updateItem(
    id: string,
    patch: Partial<Pick<ReviewItem, 'afterType' | 'afterSeverity' | 'fieldNote'>>
  ): Promise<void> {
    const item = await itemsTable.getById(id)
    if (!item) return
    const batch = await batchesTable.getById(item.batchId)
    if (!batch || batch.status !== 'open') return
    await itemsTable.update(id, patch)
  }

  /** 从批次里移除一条：仅未交卷可改 */
  async function removeItem(id: string): Promise<void> {
    const item = await itemsTable.getById(id)
    if (!item) return
    const batch = await batchesTable.getById(item.batchId)
    if (!batch || batch.status !== 'open') return
    await itemsTable.remove(id)
  }

  /** 整批删除（连册子带条目）：仅未交卷可删 */
  async function removeBatch(id: string): Promise<void> {
    const batch = await batchesTable.getById(id)
    if (!batch || batch.status !== 'open') return
    await db.transaction('rw', [db.reviewBatches, db.reviewItems], async () => {
      await db.reviewItems.where('batchId').equals(id).delete()
      await db.reviewBatches.delete(id)
    })
  }

  /**
   * 交卷：校验改判条目均已写现场情况，然后把改判落到病害档案，
   * 批次置为已交卷并锁定。册子里保留前后对照快照。
   */
  async function submitBatch(id: string): Promise<SubmitResult> {
    const batch = await batchesTable.getById(id)
    if (!batch) throw new Error('批次不存在')
    if (batch.status !== 'open') throw new Error('该批次已交卷锁定')
    const batchItems = await db.reviewItems.where('batchId').equals(id).toArray()
    const missing = findItemsMissingNote(batchItems)
    if (missing.length > 0) {
      throw new Error(`还有 ${missing.length} 条改判未写现场情况，补全后才能交卷`)
    }
    const changed = batchItems.filter(isReviewItemChanged)
    const now = Date.now()
    await db.transaction('rw', [db.decays, db.reviewBatches], async () => {
      for (const item of changed) {
        await db.decays.update(item.decayId, {
          type: item.afterType ?? item.beforeType,
          severity: item.afterSeverity ?? item.beforeSeverity,
          updatedAt: now
        })
      }
      await db.reviewBatches.update(id, { status: 'submitted', submittedAt: now, updatedAt: now })
    })
    return { applied: changed.length, kept: batchItems.length - changed.length }
  }

  return {
    batches,
    items,
    openBatchCount,
    draftDecayIds,
    itemsOf,
    batchById,
    setDraftDecayIds,
    clearDraftDecayIds,
    createBatch,
    updateBatch,
    updateItem,
    removeItem,
    removeBatch,
    submitBatch
  }
})
