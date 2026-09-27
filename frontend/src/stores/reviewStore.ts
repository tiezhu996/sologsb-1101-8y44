import { defineStore } from 'pinia'
import { computed } from 'vue'
import { db } from '@/utils/db'
import { useIdbTable } from '@/hooks/useIdbTable'
import { useDecayStore } from '@/stores/decayStore'
import { useHallStore } from '@/stores/hallStore'
import type { Decay } from '@/types/decay'
import { changedCount, entryChanged, type ReviewBatch, type ReviewEntry } from '@/types/review'

/**
 * 复核批次 store：每次外出核查单独成册。
 * 未交卷的批次可随时增删条目、逐条落结论；交卷时把改判写回病害档案并锁定，
 * 册子内保留入册时的原判快照，形成前后对照。
 */
export const useReviewStore = defineStore('review', () => {
  const batchesTable = useIdbTable<ReviewBatch>((database) => database.reviewBatches)
  const decayStore = useDecayStore()
  const hallStore = useHallStore()

  const batches = computed<ReviewBatch[]>(() => batchesTable.rows.value)
  const draftCount = computed(() => batches.value.filter((batch) => batch.state === 'draft').length)
  const submittedCount = computed(() => batches.value.filter((batch) => batch.state === 'submitted').length)
  const totalChangedEntries = computed(() =>
    batches.value.reduce((sum, batch) => sum + changedCount(batch), 0)
  )

  /** 档案台 / 批次页共用的病害选项（位置标签 + 当前判定） */
  const decayOptions = computed<Array<{ value: string; label: string }>>(() =>
    decayStore.rows.map((row) => ({
      value: row.decay.id,
      label: `${labelOfDecay(row.decay)} ｜ ${row.decay.type} · ${row.decay.severity}`
    }))
  )

  function batchById(id: string): ReviewBatch | undefined {
    return batches.value.find((batch) => batch.id === id)
  }

  /** 入册快照用的位置标签：殿宇 / 构件（部位） / 层位 */
  function labelOfDecay(decay: Decay): string {
    const layer = decayStore.layers.find((item) => item.id === decay.layerId)
    const element = layer ? decayStore.elements.find((item) => item.id === layer.elementId) : undefined
    const hall = element ? hallStore.hallById(element.hallId) : undefined
    const parts = [
      hall?.name ?? '殿宇已删除',
      element ? `${element.name}（${element.position}）` : '构件已删除',
      layer ? `第 ${layer.level} 层 · ${layer.patternName} · ${layer.pigment}` : '层位已删除'
    ]
    return parts.join(' / ')
  }

  /** 按当前档案值生成入册条目：原判快照入册，改判栏留空 */
  function buildEntry(decay: Decay): ReviewEntry {
    return {
      decayId: decay.id,
      label: labelOfDecay(decay),
      beforeType: decay.type,
      beforeSeverity: decay.severity,
      newType: null,
      newSeverity: null,
      fieldNote: ''
    }
  }

  /** 新建批次：把挑中的病害按当前档案值快照入册 */
  async function createBatch(payload: {
    title: string
    reviewer: string
    reviewDate: string
    decayIds: string[]
  }): Promise<ReviewBatch> {
    const entries = payload.decayIds
      .map((id) => decayStore.decays.find((decay) => decay.id === id))
      .filter((decay): decay is Decay => Boolean(decay))
      .map(buildEntry)
    return batchesTable.create(
      {
        title: payload.title,
        reviewer: payload.reviewer,
        reviewDate: payload.reviewDate,
        state: 'draft',
        entries,
        submittedAt: null
      },
      'rev'
    )
  }

  /** 变更前校验：已交卷的批次一律拒绝修改 */
  async function requireDraft(id: string): Promise<ReviewBatch> {
    const batch = await batchesTable.getById(id)
    if (!batch) throw new Error('复核批次不存在或已被删除')
    if (batch.state !== 'draft') throw new Error('该批次已交卷锁定，不能再修改')
    return batch
  }

  /** 改批次名称 / 复核人 / 复核日期（仅未交卷） */
  async function updateMeta(
    id: string,
    patch: Partial<Pick<ReviewBatch, 'title' | 'reviewer' | 'reviewDate'>>
  ): Promise<void> {
    await requireDraft(id)
    await batchesTable.update(id, patch)
  }

  /** 向批次追加病害（已在册的自动跳过），返回实际入册条数 */
  async function addDecays(id: string, decayIds: string[]): Promise<number> {
    const batch = await requireDraft(id)
    const existing = new Set(batch.entries.map((entry) => entry.decayId))
    const additions = decayIds
      .filter((decayId) => !existing.has(decayId))
      .map((decayId) => decayStore.decays.find((decay) => decay.id === decayId))
      .filter((decay): decay is Decay => Boolean(decay))
      .map(buildEntry)
    if (additions.length === 0) return 0
    await batchesTable.update(id, { entries: [...batch.entries, ...additions] })
    return additions.length
  }

  /** 把某条病害移出批次（仅未交卷，不影响档案） */
  async function removeEntry(id: string, decayId: string): Promise<void> {
    const batch = await requireDraft(id)
    await batchesTable.update(id, {
      entries: batch.entries.filter((entry) => entry.decayId !== decayId)
    })
  }

  /** 逐条落结论：改判类型 / 程度与现场情况（仅未交卷） */
  async function setEntryConclusion(
    id: string,
    decayId: string,
    patch: Partial<Pick<ReviewEntry, 'newType' | 'newSeverity' | 'fieldNote'>>
  ): Promise<void> {
    const batch = await requireDraft(id)
    const entries = batch.entries.map((entry) =>
      entry.decayId === decayId ? { ...entry, ...patch } : entry
    )
    await batchesTable.update(id, { entries })
  }

  /**
   * 交卷：校验复核人、日期齐全且改判条目均填了现场情况后，
   * 在同一事务里把改判写回病害档案并锁定批次，册子保留前后对照。
   */
  async function submitBatch(id: string): Promise<{ changed: number; total: number }> {
    const batch = await requireDraft(id)
    if (batch.entries.length === 0) throw new Error('批次内还没有病害条目，无法交卷')
    if (batch.reviewer.trim().length === 0) throw new Error('请先填写复核人再交卷')
    if (batch.reviewDate.trim().length === 0) throw new Error('请先选择复核日期再交卷')
    const missingNote = batch.entries.filter(
      (entry) => entryChanged(entry) && entry.fieldNote.trim().length === 0
    )
    if (missingNote.length > 0) {
      throw new Error(`有 ${missingNote.length} 条改判未填写现场情况，无法交卷`)
    }
    const changedEntries = batch.entries.filter(entryChanged)
    const now = Date.now()
    await db.transaction('rw', [db.reviewBatches, db.decays], async () => {
      for (const entry of changedEntries) {
        await db.decays.update(entry.decayId, {
          ...(entry.newType !== null ? { type: entry.newType } : {}),
          ...(entry.newSeverity !== null ? { severity: entry.newSeverity } : {}),
          updatedAt: now
        })
      }
      await db.reviewBatches.update(id, { state: 'submitted', submittedAt: now, updatedAt: now })
    })
    return { changed: changedEntries.length, total: batch.entries.length }
  }

  /** 仅未交卷的批次可删除；已交卷的册子留档备查，不可删改 */
  async function removeBatch(id: string): Promise<void> {
    const batch = await batchesTable.getById(id)
    if (!batch) return
    if (batch.state !== 'draft') throw new Error('已交卷的批次已锁定，不能删除')
    await batchesTable.remove(id)
  }

  return {
    batches,
    draftCount,
    submittedCount,
    totalChangedEntries,
    decayOptions,
    batchById,
    labelOfDecay,
    createBatch,
    updateMeta,
    addDecays,
    removeEntry,
    setEntryConclusion,
    submitBatch,
    removeBatch
  }
})
