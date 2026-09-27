<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { useReviewStore } from '@/stores/reviewStore'
import type { ReviewBatch } from '@/types/review'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    /** 从档案台勾选带入的病害；传入后隐藏挑病害选择器 */
    presetDecayIds?: string[]
  }>(),
  { presetDecayIds: undefined }
)

const emit = defineEmits<{
  (event: 'update:modelValue', value: boolean): void
  (event: 'created', batch: ReviewBatch): void
}>()

const reviewStore = useReviewStore()

const title = ref('')
const reviewer = ref('')
const reviewDate = ref('')
const pickedIds = ref<string[]>([])
const submitting = ref(false)

const visible = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value)
})

/** 有预选病害时不再展示选择器 */
const showPicker = computed(() => !props.presetDecayIds || props.presetDecayIds.length === 0)

function today(): string {
  const now = new Date()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${mm}-${dd}`
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    title.value = `现场复核 ${today()}`
    // 复核人沿用上一次的填写，少敲一遍
    reviewer.value = reviewStore.batches[0]?.reviewer ?? ''
    reviewDate.value = today()
    pickedIds.value = []
  }
)

async function submit(): Promise<void> {
  const decayIds = showPicker.value ? pickedIds.value : (props.presetDecayIds ?? [])
  if (title.value.trim().length === 0) {
    ElMessage.warning('请填写批次名称')
    return
  }
  if (reviewer.value.trim().length === 0) {
    ElMessage.warning('请填写复核人')
    return
  }
  if (!reviewDate.value) {
    ElMessage.warning('请选择复核日期')
    return
  }
  if (decayIds.length === 0) {
    ElMessage.warning('请至少挑一条病害入册')
    return
  }
  submitting.value = true
  try {
    const batch = await reviewStore.createBatch({
      title: title.value.trim(),
      reviewer: reviewer.value.trim(),
      reviewDate: reviewDate.value,
      decayIds
    })
    visible.value = false
    emit('created', batch)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <el-dialog v-model="visible" title="新建复核批次" width="560px">
    <el-form label-width="90px">
      <el-form-item label="批次名称">
        <el-input v-model="title" maxlength="40" show-word-limit placeholder="如：现场复核 · 大雄宝殿檐下" />
      </el-form-item>
      <el-form-item label="复核人">
        <el-input v-model="reviewer" maxlength="20" placeholder="本次外出核查的复核人" />
      </el-form-item>
      <el-form-item label="复核日期">
        <el-date-picker v-model="reviewDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
      </el-form-item>
      <el-form-item v-if="showPicker" label="挑病害">
        <el-select
          v-model="pickedIds"
          multiple
          filterable
          collapse-tags
          collapse-tags-tooltip
          :max-collapse-tags="3"
          class="full-width"
          placeholder="从病害档案中挑选本次要核的记录"
        >
          <el-option
            v-for="option in reviewStore.decayOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
      </el-form-item>
      <el-form-item v-else label="挑病害">
        <el-tag type="primary" effect="plain" round>已按档案台勾选带入 {{ presetDecayIds?.length ?? 0 }} 条</el-tag>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">成册</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.full-width {
  width: 100%;
}
</style>
