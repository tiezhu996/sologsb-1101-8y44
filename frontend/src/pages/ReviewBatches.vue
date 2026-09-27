<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Check, Delete, Lock, Plus } from '@element-plus/icons-vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import SeverityTag from '@/components/common/SeverityTag.vue'
import { useDecayStore } from '@/stores/decayStore'
import { useHallStore } from '@/stores/hallStore'
import { useReviewStore } from '@/stores/reviewStore'
import { DECAY_TYPES, SEVERITIES, type DecayType, type Severity } from '@/types/decay'
import { isReviewItemChanged, summarizeItems, type ReviewBatch, type ReviewItem } from '@/types/review'

const route = useRoute()
const decayStore = useDecayStore()
const hallStore = useHallStore()
const reviewStore = useReviewStore()

const activeBatchId = ref<string | null>(null)
const createDialogVisible = ref(false)
const createForm = ref({ title: '', reviewer: '', reviewDate: '' })
const createSelectedIds = ref<string[]>([])
const submitting = ref(false)

const activeBatch = computed<ReviewBatch | null>(() =>
  activeBatchId.value ? reviewStore.batchById(activeBatchId.value) ?? null : null
)
const activeItems = computed<ReviewItem[]>(() =>
  activeBatchId.value ? reviewStore.itemsOf(activeBatchId.value) : []
)
const activeSummary = computed(() => summarizeItems(activeItems.value))
const isOpen = computed(() => activeBatch.value?.status === 'open')

/** 病害 id → 位置描述（殿宇 / 构件 / 层位），供批次条目表展示 */
const decayPlaceMap = computed(() => {
  const map = new Map<string, string>()
  decayStore.rows.forEach((row) => {
    const hallName = row.element ? hallStore.hallById(row.element.hallId)?.name ?? '殿宇已删除' : '-'
    const elementName = row.element ? `${row.element.name}（${row.element.position}）` : '构件已删除'
    const layerName = row.layer ? `第 ${row.layer.level} 层 · ${row.layer.patternName} · ${row.layer.pigment}` : '层位已删除'
    map.set(row.decay.id, `${hallName} / ${elementName} / ${layerName}`)
  })
  return map
})

function placeLabel(decayId: string): string {
  return decayPlaceMap.value.get(decayId) ?? '病害档案已删除'
}

function batchSummary(batchId: string): { total: number; changed: number } {
  return summarizeItems(reviewStore.itemsOf(batchId))
}

function formatTime(ts: number | null): string {
  if (!ts) return '-'
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function todayText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function openCreateDialog(): void {
  const draft = reviewStore.draftDecayIds.filter((id) => decayStore.decays.some((decay) => decay.id === id))
  createSelectedIds.value = draft
  createForm.value = {
    title: `${todayText()} 现场复核`,
    reviewer: '',
    reviewDate: todayText()
  }
  createDialogVisible.value = true
}

function toggleCreateSelection(id: string): void {
  const index = createSelectedIds.value.indexOf(id)
  if (index >= 0) createSelectedIds.value.splice(index, 1)
  else createSelectedIds.value.push(id)
}

async function submitCreate(): Promise<void> {
  const reviewer = createForm.value.reviewer.trim()
  if (!reviewer) {
    ElMessage.warning('请填写复核人')
    return
  }
  if (!createForm.value.reviewDate) {
    ElMessage.warning('请选择复核日期')
    return
  }
  const picked = decayStore.decays.filter((decay) => createSelectedIds.value.includes(decay.id))
  if (picked.length === 0) {
    ElMessage.warning('请至少勾选一条要现场复核的病害')
    return
  }
  const batch = await reviewStore.createBatch({
    title: createForm.value.title.trim() || `${createForm.value.reviewDate} 现场复核`,
    reviewer,
    reviewDate: createForm.value.reviewDate,
    decays: picked
  })
  reviewStore.clearDraftDecayIds()
  createDialogVisible.value = false
  activeBatchId.value = batch.id
  ElMessage.success(`批次已建，共 ${picked.length} 条待核`)
}

function openBatch(batch: ReviewBatch): void {
  activeBatchId.value = batch.id
}

function closeDetail(): void {
  activeBatchId.value = null
}

async function removeBatch(batch: ReviewBatch): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `删除批次「${batch.title}」及其全部复核记录？病害档案不受影响。`,
    '删除批次',
    { type: 'warning' }
  ).catch(() => false)
  if (!confirmed) return
  await reviewStore.removeBatch(batch.id)
  if (activeBatchId.value === batch.id) activeBatchId.value = null
  ElMessage.success('批次已删除')
}

async function removeItem(item: ReviewItem): Promise<void> {
  await reviewStore.removeItem(item.id)
  ElMessage.success('已从批次移除该条')
}

function onAfterTypeChange(item: ReviewItem, value: DecayType | '' | undefined): void {
  void reviewStore.updateItem(item.id, { afterType: value ? value : null })
}

function onAfterSeverityChange(item: ReviewItem, value: Severity | '' | undefined): void {
  void reviewStore.updateItem(item.id, { afterSeverity: value ? value : null })
}

function onFieldNoteChange(item: ReviewItem, value: string): void {
  void reviewStore.updateItem(item.id, { fieldNote: value })
}

function onBatchMetaChange(): void {
  if (!activeBatch.value || !isOpen.value) return
  void reviewStore.updateBatch(activeBatch.value.id, {
    title: activeBatch.value.title,
    reviewer: activeBatch.value.reviewer,
    reviewDate: activeBatch.value.reviewDate
  })
}

async function submitBatch(): Promise<void> {
  const batch = activeBatch.value
  if (!batch) return
  const summary = activeSummary.value
  const confirmed = await ElMessageBox.confirm(
    `本批共 ${summary.total} 条，其中改判 ${summary.changed} 条、维持原判 ${summary.total - summary.changed} 条。` +
      '交卷后改判将落到病害档案，批次锁定不可再改。确认交卷？',
    '交卷确认',
    { type: 'warning', confirmButtonText: '确认交卷', cancelButtonText: '再核一遍' }
  ).catch(() => false)
  if (!confirmed) return
  submitting.value = true
  try {
    const result = await reviewStore.submitBatch(batch.id)
    ElMessage.success(`已交卷：${result.applied} 条改判落档，${result.kept} 条维持原判`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '交卷失败')
  } finally {
    submitting.value = false
  }
}

function itemChanged(item: ReviewItem): boolean {
  return isReviewItemChanged(item)
}

function missingNote(item: ReviewItem): boolean {
  return itemChanged(item) && item.fieldNote.trim().length === 0
}

onMounted(() => {
  if (route.query.create === '1') openCreateDialog()
})

const decayTypeOptions = DECAY_TYPES
const severityOptions = SEVERITIES
</script>

<template>
  <div>
    <div class="page-title">
      <div>
        <h2>现场复核批次</h2>
        <p>
          共 {{ reviewStore.batches.length }} 批，未交卷 {{ reviewStore.openBatchCount }} 批；
          交卷后改判落到病害档案，册子留前后对照并锁定。
        </p>
      </div>
      <el-button type="primary" :icon="Plus" @click="openCreateDialog">新建复核批次</el-button>
    </div>

    <div class="section-card">
      <div class="section-card__head">
        <h3>批次册子</h3>
        <span class="muted">没交卷的随时能改，交卷后锁住</span>
      </div>
      <el-table v-if="reviewStore.batches.length > 0" :data="reviewStore.batches" row-key="id">
        <el-table-column label="批次题名" prop="title" min-width="220" show-overflow-tooltip />
        <el-table-column label="复核人" prop="reviewer" width="110" />
        <el-table-column label="复核日期" prop="reviewDate" width="120" />
        <el-table-column label="条目" width="90">
          <template #default="{ row }">
            <span class="mono">{{ batchSummary(row.id).total }} 条</span>
          </template>
        </el-table-column>
        <el-table-column label="改判" width="90">
          <template #default="{ row }">
            <span class="mono">{{ batchSummary(row.id).changed }} 条</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag v-if="row.status === 'open'" type="warning" effect="plain">未交卷</el-tag>
            <el-tag v-else type="success" effect="plain">
              <el-icon class="tag-icon"><Lock /></el-icon>已交卷
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="交卷时间" width="150">
          <template #default="{ row }">{{ formatTime(row.submittedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="primary" @click="openBatch(row)">
              {{ row.status === 'open' ? '逐条落结论' : '查看对照' }}
            </el-button>
            <el-button v-if="row.status === 'open'" size="small" text type="danger" :icon="Delete" @click="removeBatch(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <EmptyPanel
        v-else
        title="还没有复核批次"
        description="出门核病害前，先挑几条病害组成一批，写明复核人和日期；回来逐条落结论，整批核完点交卷。"
        action-text="新建复核批次"
        @action="openCreateDialog"
      />
    </div>

    <div v-if="activeBatch" class="section-card detail-card">
      <div class="section-card__head">
        <h3>
          {{ activeBatch.title }}
          <el-tag v-if="isOpen" type="warning" effect="plain" size="small">未交卷</el-tag>
          <el-tag v-else type="success" effect="plain" size="small">
            <el-icon class="tag-icon"><Lock /></el-icon>已交卷 · {{ formatTime(activeBatch.submittedAt) }}
          </el-tag>
        </h3>
        <el-button size="small" text @click="closeDetail">收起</el-button>
      </div>

      <div class="batch-meta">
        <span class="batch-meta__label">批次题名</span>
        <el-input v-model="activeBatch.title" :disabled="!isOpen" class="batch-meta__title" @change="onBatchMetaChange" />
        <span class="batch-meta__label">复核人</span>
        <el-input v-model="activeBatch.reviewer" :disabled="!isOpen" class="batch-meta__reviewer" @change="onBatchMetaChange" />
        <span class="batch-meta__label">复核日期</span>
        <el-date-picker
          v-model="activeBatch.reviewDate"
          type="date"
          value-format="YYYY-MM-DD"
          :disabled="!isOpen"
          @change="onBatchMetaChange"
        />
      </div>

      <p class="muted detail-hint">
        原判不变的空着即可；改判严重程度或类型的，请在现场情况里写清看到的情形。
        当前 {{ activeSummary.total }} 条，改判 {{ activeSummary.changed }} 条。
      </p>

      <el-table :data="activeItems" row-key="id">
        <el-table-column label="位置（殿宇 / 构件 / 层位）" min-width="240">
          <template #default="{ row }">{{ placeLabel(row.decayId) }}</template>
        </el-table-column>
        <el-table-column label="原判" width="170">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ row.beforeType }}</el-tag>
            <SeverityTag :severity="row.beforeSeverity" :area-cm2="row.beforeAreaCm2" size="small" plain />
          </template>
        </el-table-column>
        <el-table-column v-if="isOpen" label="改判类型" width="130">
          <template #default="{ row }">
            <el-select
              :model-value="row.afterType ?? ''"
              size="small"
              placeholder="维持原判"
              clearable
              @change="(value: DecayType | '' | undefined) => onAfterTypeChange(row, value)"
            >
              <el-option v-for="item in decayTypeOptions" :key="item" :label="item" :value="item" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column v-if="isOpen" label="改判程度" width="120">
          <template #default="{ row }">
            <el-select
              :model-value="row.afterSeverity ?? ''"
              size="small"
              placeholder="维持原判"
              clearable
              @change="(value: Severity | '' | undefined) => onAfterSeverityChange(row, value)"
            >
              <el-option v-for="item in severityOptions" :key="item" :label="item" :value="item" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column v-else label="复核结论" width="200">
          <template #default="{ row }">
            <template v-if="itemChanged(row)">
              <el-tag size="small" effect="plain">{{ row.afterType ?? row.beforeType }}</el-tag>
              <SeverityTag :severity="row.afterSeverity ?? row.beforeSeverity" size="small" />
            </template>
            <span v-else class="muted">维持原判</span>
          </template>
        </el-table-column>
        <el-table-column label="现场情况" min-width="220">
          <template #default="{ row }">
            <el-input
              v-if="isOpen"
              :model-value="row.fieldNote"
              size="small"
              type="textarea"
              :rows="1"
              autosize
              :placeholder="itemChanged(row) ? '改判必填：写清现场看到的情形' : '原判不变可空着'"
              @update:model-value="(value: string) => onFieldNoteChange(row, value)"
            />
            <span v-else>{{ row.fieldNote || '—' }}</span>
            <div v-if="isOpen && missingNote(row)" class="missing-note">改判须写现场情况</div>
          </template>
        </el-table-column>
        <el-table-column label="结论" width="90">
          <template #default="{ row }">
            <el-tag v-if="itemChanged(row)" size="small" type="danger" effect="plain">改判</el-tag>
            <el-tag v-else size="small" type="info" effect="plain">原判不变</el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="isOpen" label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button size="small" text type="danger" @click="removeItem(row)">移除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div v-if="isOpen" class="detail-actions">
        <el-button type="primary" :icon="Check" :loading="submitting" @click="submitBatch">整批核完，交卷</el-button>
        <span class="muted">交卷后改判落到病害档案，批次锁定</span>
      </div>
      <p v-else class="muted detail-hint">本批已交卷锁定，上表为前后对照：原判快照与落档结论并列，可供倒查。</p>
    </div>

    <el-dialog v-model="createDialogVisible" title="新建复核批次" width="720px">
      <el-form label-width="90px">
        <el-form-item label="批次题名">
          <el-input v-model="createForm.title" maxlength="60" show-word-limit />
        </el-form-item>
        <el-form-item label="复核人">
          <el-input v-model="createForm.reviewer" maxlength="20" placeholder="本次出门核病害的人" />
        </el-form-item>
        <el-form-item label="复核日期">
          <el-date-picker v-model="createForm.reviewDate" type="date" value-format="YYYY-MM-DD" />
        </el-form-item>
        <el-form-item :label="`挑病害（已选 ${createSelectedIds.length} 条）`">
          <div class="pick-list">
            <div
              v-for="row in decayStore.rows"
              :key="row.decay.id"
              class="pick-list__row"
              :class="{ 'is-picked': createSelectedIds.includes(row.decay.id) }"
              @click="toggleCreateSelection(row.decay.id)"
            >
              <el-checkbox
                :model-value="createSelectedIds.includes(row.decay.id)"
                @click.stop
                @change="toggleCreateSelection(row.decay.id)"
              />
              <span class="pick-list__place">{{ placeLabel(row.decay.id) }}</span>
              <el-tag size="small" effect="plain">{{ row.decay.type }}</el-tag>
              <SeverityTag :severity="row.decay.severity" :area-cm2="row.decay.areaCm2" size="small" plain />
            </div>
            <p v-if="decayStore.rows.length === 0" class="muted">档案里还没有病害记录，请先在病害档案台录入。</p>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submitCreate">组成批次</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.detail-card {
  margin-top: 16px;
}

.tag-icon {
  margin-right: 2px;
  vertical-align: -2px;
}

.batch-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.batch-meta__label {
  font-size: 13px;
  color: #6b6257;
}

.batch-meta__title {
  width: 260px;
}

.batch-meta__reviewer {
  width: 140px;
}

.detail-hint {
  margin: 0 0 10px;
  font-size: 12px;
}

.missing-note {
  margin-top: 2px;
  font-size: 12px;
  color: #c0392b;
}

.detail-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
}

.pick-list {
  width: 100%;
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid #e5ddcf;
  border-radius: 8px;
}

.pick-list__row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  border-bottom: 1px solid #f0e9dc;
}

.pick-list__row:last-child {
  border-bottom: none;
}

.pick-list__row.is-picked {
  background: #fdf3e3;
}

.pick-list__place {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
