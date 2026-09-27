<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { CircleCheck, Delete, Edit, Plus, View } from '@element-plus/icons-vue'
import EmptyPanel from '@/components/common/EmptyPanel.vue'
import SeverityTag from '@/components/common/SeverityTag.vue'
import StatBadge from '@/components/common/StatBadge.vue'
import CreateBatchDialog from '@/components/review/CreateBatchDialog.vue'
import { useReviewStore } from '@/stores/reviewStore'
import { DECAY_TYPES, SEVERITIES, type DecayType, type Severity } from '@/types/decay'
import {
  changedCount,
  entryChanged,
  entryNowSeverity,
  entryNowType,
  type ReviewBatch,
  type ReviewEntry
} from '@/types/review'

const reviewStore = useReviewStore()

const createVisible = ref(false)
const drawerVisible = ref(false)
const activeBatchId = ref<string | null>(null)
const addVisible = ref(false)
const addPickedIds = ref<string[]>([])
const submitting = ref(false)

const activeBatch = computed<ReviewBatch | null>(() =>
  activeBatchId.value ? reviewStore.batchById(activeBatchId.value) ?? null : null
)
const isDraft = computed(() => activeBatch.value?.state === 'draft')

/** 添加病害对话框的选项：已在册的置灰 */
const addOptions = computed(() => {
  const existing = new Set((activeBatch.value?.entries ?? []).map((entry) => entry.decayId))
  return reviewStore.decayOptions.map((option) => ({
    ...option,
    disabled: existing.has(option.value)
  }))
})

// 批次被删除（或异常消失）时收起册子
watch(activeBatch, (batch) => {
  if (!batch && drawerVisible.value) drawerVisible.value = false
})

const decayTypes = DECAY_TYPES
const severities = SEVERITIES

function formatDateTime(timestamp: number | null): string {
  if (!timestamp) return '—'
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`
}

function openBatch(batch: ReviewBatch): void {
  activeBatchId.value = batch.id
  drawerVisible.value = true
}

function onCreated(batch: ReviewBatch): void {
  ElMessage.success(`已建批次「${batch.title}」，入册 ${batch.entries.length} 条，可逐条落结论`)
  openBatch(batch)
}

function saveMeta(patch: Partial<Pick<ReviewBatch, 'title' | 'reviewer' | 'reviewDate'>>): void {
  const batch = activeBatch.value
  if (!batch) return
  if (patch.title !== undefined && patch.title.trim().length === 0) {
    ElMessage.warning('批次名称不能为空')
    return
  }
  reviewStore.updateMeta(batch.id, patch).catch((err: unknown) => {
    ElMessage.error(err instanceof Error ? err.message : '保存批次信息失败')
  })
}

function onDateChange(value: string | null): void {
  saveMeta({ reviewDate: value ?? '' })
}

async function saveConclusion(
  entry: ReviewEntry,
  patch: Partial<Pick<ReviewEntry, 'newType' | 'newSeverity' | 'fieldNote'>>
): Promise<void> {
  const batch = activeBatch.value
  if (!batch) return
  try {
    await reviewStore.setEntryConclusion(batch.id, entry.decayId, patch)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '保存结论失败')
  }
}

function onTypeChange(entry: ReviewEntry, value: DecayType | ''): void {
  void saveConclusion(entry, { newType: value === '' ? null : value })
}

function onSeverityChange(entry: ReviewEntry, value: Severity | ''): void {
  void saveConclusion(entry, { newSeverity: value === '' ? null : value })
}

function onNoteChange(entry: ReviewEntry, value: string): void {
  void saveConclusion(entry, { fieldNote: value })
}

function openAdd(): void {
  addPickedIds.value = []
  addVisible.value = true
}

async function confirmAdd(): Promise<void> {
  const batch = activeBatch.value
  if (!batch) return
  if (addPickedIds.value.length === 0) {
    ElMessage.warning('请先选择要入册的病害')
    return
  }
  try {
    const added = await reviewStore.addDecays(batch.id, addPickedIds.value)
    addVisible.value = false
    addPickedIds.value = []
    ElMessage.success(added > 0 ? `已入册 ${added} 条` : '所选病害均已在册')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '添加失败')
  }
}

async function removeEntry(entry: ReviewEntry): Promise<void> {
  const batch = activeBatch.value
  if (!batch) return
  try {
    await reviewStore.removeEntry(batch.id, entry.decayId)
    ElMessage.success('已移出本批次，病害档案不受影响')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '移出失败')
  }
}

async function submitActive(): Promise<void> {
  const batch = activeBatch.value
  if (!batch || submitting.value) return
  const changed = changedCount(batch)
  const confirmed = await ElMessageBox.confirm(
    `交卷后批次锁定不可再改，${changed} 条改判将写入病害档案，册子保留前后对照。是否继续？`,
    '交卷确认',
    { type: 'warning', confirmButtonText: '交卷', cancelButtonText: '再核一遍' }
  ).catch(() => false)
  if (!confirmed) return
  submitting.value = true
  try {
    const result = await reviewStore.submitBatch(batch.id)
    ElMessage.success(`已交卷：共 ${result.total} 条，${result.changed} 条改判已写入病害档案`)
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '交卷失败')
  } finally {
    submitting.value = false
  }
}

async function removeBatch(batch: ReviewBatch): Promise<void> {
  const confirmed = await ElMessageBox.confirm(
    `删除未交卷的批次「${batch.title}」？仅删除册子，病害档案不受影响。`,
    '删除确认',
    { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
  ).catch(() => false)
  if (!confirmed) return
  try {
    await reviewStore.removeBatch(batch.id)
    ElMessage.success('批次已删除')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '删除失败')
  }
}

function rowKey(row: ReviewBatch): string {
  return row.id
}

function entryRowKey(row: ReviewEntry): string {
  return row.decayId
}
</script>

<template>
  <div>
    <div class="page-title">
      <div>
        <h2>现场复核批次</h2>
        <p>每次外出核查单独成册：挑病害、写明复核人与日期、逐条落结论，交卷后写回档案并锁定，册子留存前后对照。</p>
      </div>
      <el-button type="primary" :icon="Plus" @click="createVisible = true">新建复核批次</el-button>
    </div>

    <div class="stat-row">
      <StatBadge label="批次总数" :value="reviewStore.batches.length" suffix="册" icon="Files" tone="primary" />
      <StatBadge label="未交卷" :value="reviewStore.draftCount" suffix="册" icon="WarningFilled" tone="warning" />
      <StatBadge label="已交卷" :value="reviewStore.submittedCount" suffix="册" icon="TrendCharts" tone="success" />
      <StatBadge label="累计改判" :value="reviewStore.totalChangedEntries" suffix="条" icon="Histogram" tone="danger" />
    </div>

    <div class="section-card">
      <div class="section-card__head">
        <h3>批次册子</h3>
        <span class="muted">未交卷可随时打开修改，交卷后锁定留档</span>
      </div>

      <el-table v-if="reviewStore.batches.length > 0" :data="reviewStore.batches" :row-key="rowKey">
        <el-table-column label="批次名称" prop="title" min-width="200" show-overflow-tooltip />
        <el-table-column label="复核人" prop="reviewer" width="110" />
        <el-table-column label="复核日期" prop="reviewDate" width="120" />
        <el-table-column label="状态" width="96">
          <template #default="{ row }">
            <el-tag size="small" :type="row.state === 'submitted' ? 'success' : 'warning'" effect="plain">
              {{ row.state === 'submitted' ? '已交卷' : '未交卷' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="条目" width="150">
          <template #default="{ row }">
            <span class="mono">{{ row.entries.length }} 条</span>
            <span v-if="changedCount(row) > 0" class="muted"> · 改判 {{ changedCount(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="更新时间" width="150">
          <template #default="{ row }">
            <span class="mono muted">{{ formatDateTime(row.updatedAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="190" fixed="right">
          <template #default="{ row }">
            <el-button
              size="small"
              text
              type="primary"
              :icon="row.state === 'submitted' ? View : Edit"
              @click="openBatch(row)"
            >
              {{ row.state === 'submitted' ? '查看对照' : '落结论' }}
            </el-button>
            <el-button
              v-if="row.state === 'draft'"
              size="small"
              text
              type="danger"
              :icon="Delete"
              @click="removeBatch(row)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <EmptyPanel
        v-else
        title="还没有复核批次"
        description="外出核查前，可在病害档案台勾选本次要核的病害组成批次，也可以先建空册再逐条添加。"
        action-text="新建复核批次"
        @action="createVisible = true"
      />
    </div>

    <CreateBatchDialog v-model="createVisible" @created="onCreated" />

    <el-drawer v-model="drawerVisible" size="80%" destroy-on-close>
      <template #header>
        <div class="drawer-head">
          <strong>{{ activeBatch?.title ?? '复核批次' }}</strong>
          <el-tag
            v-if="activeBatch"
            size="small"
            :type="activeBatch.state === 'submitted' ? 'success' : 'warning'"
            effect="plain"
          >
            {{ activeBatch.state === 'submitted' ? '已交卷锁定' : '未交卷 · 可修改' }}
          </el-tag>
        </div>
      </template>

      <div v-if="activeBatch" class="drawer-body">
        <div class="section-card">
          <div class="section-card__head">
            <h3>批次信息</h3>
            <span class="muted">复核人 {{ activeBatch.reviewer || '未填写' }} · 复核日期 {{ activeBatch.reviewDate || '未选择' }}</span>
          </div>
          <el-form v-if="isDraft" label-width="90px" class="meta-form">
            <el-form-item label="批次名称">
              <el-input
                :model-value="activeBatch.title"
                maxlength="40"
                @change="saveMeta({ title: $event })"
              />
            </el-form-item>
            <el-form-item label="复核人">
              <el-input
                :model-value="activeBatch.reviewer"
                maxlength="20"
                placeholder="必填，交卷前可补"
                @change="saveMeta({ reviewer: $event })"
              />
            </el-form-item>
            <el-form-item label="复核日期">
              <el-date-picker
                :model-value="activeBatch.reviewDate"
                type="date"
                value-format="YYYY-MM-DD"
                placeholder="选择日期"
                @change="onDateChange"
              />
            </el-form-item>
          </el-form>
          <el-alert
            v-else
            type="success"
            :closable="false"
            :title="`已于 ${formatDateTime(activeBatch.submittedAt)} 交卷锁定：共 ${activeBatch.entries.length} 条，${changedCount(activeBatch)} 条改判已写入病害档案`"
          />
        </div>

        <div class="section-card">
          <div class="section-card__head">
            <h3>{{ isDraft ? '逐条落结论' : '前后对照' }}</h3>
            <el-button v-if="isDraft" size="small" :icon="Plus" @click="openAdd">添加病害</el-button>
          </div>

          <el-table
            v-if="isDraft && activeBatch.entries.length > 0"
            :data="activeBatch.entries"
            :row-key="entryRowKey"
          >
            <el-table-column label="病害位置" min-width="210">
              <template #default="{ row }">{{ row.label }}</template>
            </el-table-column>
            <el-table-column label="原判" width="160">
              <template #default="{ row }">
                <el-tag size="small" effect="plain">{{ row.beforeType }}</el-tag>
                <SeverityTag :severity="row.beforeSeverity" size="small" class="judgement-tag" />
              </template>
            </el-table-column>
            <el-table-column label="改判类型" width="150">
              <template #default="{ row }">
                <el-select
                  :model-value="row.newType ?? ''"
                  size="small"
                  @update:model-value="onTypeChange(row, $event)"
                >
                  <el-option :label="`维持原判（${row.beforeType}）`" :value="''" />
                  <el-option v-for="item in decayTypes" :key="item" :label="item" :value="item" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="改判程度" width="140">
              <template #default="{ row }">
                <el-select
                  :model-value="row.newSeverity ?? ''"
                  size="small"
                  @update:model-value="onSeverityChange(row, $event)"
                >
                  <el-option :label="`维持原判（${row.beforeSeverity}）`" :value="''" />
                  <el-option v-for="item in severities" :key="item" :label="item" :value="item" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="现场情况" min-width="230">
              <template #default="{ row }">
                <el-input
                  :model-value="row.fieldNote"
                  type="textarea"
                  :rows="1"
                  autosize
                  maxlength="200"
                  :placeholder="entryChanged(row) ? '改判必填：现场看到的情况' : '维持原判可空着'"
                  @change="onNoteChange(row, $event)"
                />
                <p v-if="entryChanged(row) && row.fieldNote.trim().length === 0" class="field-warn">
                  改判需填写现场情况才能交卷
                </p>
              </template>
            </el-table-column>
            <el-table-column label="" width="70" fixed="right">
              <template #default="{ row }">
                <el-button size="small" text type="danger" @click="removeEntry(row)">移出</el-button>
              </template>
            </el-table-column>
          </el-table>

          <el-table
            v-else-if="!isDraft && activeBatch.entries.length > 0"
            :data="activeBatch.entries"
            :row-key="entryRowKey"
          >
            <el-table-column label="病害位置" min-width="200">
              <template #default="{ row }">{{ row.label }}</template>
            </el-table-column>
            <el-table-column label="原判（入册时）" width="170">
              <template #default="{ row }">
                <el-tag size="small" effect="plain">{{ row.beforeType }}</el-tag>
                <SeverityTag :severity="row.beforeSeverity" size="small" class="judgement-tag" />
              </template>
            </el-table-column>
            <el-table-column label="现判（交卷后）" width="200">
              <template #default="{ row }">
                <el-tag size="small" effect="plain" :type="row.newType ? 'danger' : 'info'">
                  {{ entryNowType(row) }}
                </el-tag>
                <SeverityTag :severity="entryNowSeverity(row)" size="small" class="judgement-tag" />
                <el-tag v-if="entryChanged(row)" size="small" type="danger" class="changed-flag">改</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="现场情况" min-width="230">
              <template #default="{ row }">
                <span v-if="row.fieldNote">{{ row.fieldNote }}</span>
                <span v-else class="muted">维持原判</span>
              </template>
            </el-table-column>
          </el-table>

          <EmptyPanel
            v-else
            compact
            title="册子还是空的"
            description="把本次要核的病害挑进册子，再逐条落结论。"
            action-text="添加病害"
            @action="openAdd"
          />
        </div>
      </div>

      <template #footer>
        <div v-if="activeBatch && isDraft" class="drawer-footer">
          <span class="muted">
            共 {{ activeBatch.entries.length }} 条 · 改判 {{ changedCount(activeBatch) }} 条，交卷后写回档案并锁定
          </span>
          <el-button type="primary" :icon="CircleCheck" :loading="submitting" @click="submitActive">交卷</el-button>
        </div>
      </template>
    </el-drawer>

    <el-dialog v-model="addVisible" title="添加病害入册" width="560px">
      <el-select
        v-model="addPickedIds"
        multiple
        filterable
        collapse-tags
        collapse-tags-tooltip
        :max-collapse-tags="3"
        class="full-width"
        placeholder="从病害档案中挑选（已在册的已置灰）"
      >
        <el-option
          v-for="option in addOptions"
          :key="option.value"
          :label="option.label"
          :value="option.value"
          :disabled="option.disabled"
        />
      </el-select>
      <template #footer>
        <el-button @click="addVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmAdd">入册</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.drawer-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 16px;
}

.drawer-body {
  padding-bottom: 8px;
}

.meta-form {
  max-width: 520px;
}

.judgement-tag {
  margin-left: 6px;
}

.changed-flag {
  margin-left: 6px;
}

.field-warn {
  margin: 4px 0 0;
  font-size: 12px;
  color: #c0392b;
}

.drawer-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.full-width {
  width: 100%;
}
</style>
