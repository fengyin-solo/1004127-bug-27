<template>
  <div class="dialog-mask" @click.self="$emit('close')">
    <div class="dialog" role="dialog" aria-modal="true" aria-label="加油复核">
      <header class="dialog-head">
        <h3>复核加油记录</h3>
        <button class="link" type="button" @click="$emit('close')">关闭</button>
      </header>
      <div class="dialog-body">
        <dl class="record-meta">
          <div><dt>加油编号</dt><dd>{{ record.fuelingNo }}</dd></div>
          <div><dt>关联航班</dt><dd>{{ record.flightNo }}</dd></div>
          <div><dt>加油车号</dt><dd>{{ record.truckNo }}</dd></div>
          <div><dt>申报加油量</dt><dd>{{ record.reportedLiters }} 升（保持不变）</dd></div>
        </dl>
        <form class="review-form" @submit.prevent="submit">
          <label class="filter-item">
            <span>复核确认加油量（升）</span>
            <input v-model="confirmedLiters" type="number" min="1" step="50" autofocus />
          </label>
          <label class="filter-item">
            <span>复核人</span>
            <input v-model="reviewer" placeholder="请输入复核人" />
          </label>
          <p v-if="hint" class="hint" :class="{ 'is-warn': !outcomeOk }">{{ hint }}</p>
          <div class="dialog-actions">
            <button class="btn" type="button" @click="$emit('close')">取消</button>
            <button class="btn primary" type="submit" :disabled="submitting">
              {{ submitting ? '提交中…' : '确认复核' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

import type { FuelingRecord, ReviewOutcome } from '../review-types'

const props = defineProps<{
  record: FuelingRecord
  submitting: boolean
}>()
const emit = defineEmits<{
  close: []
  submit: [payload: { confirmedLiters: number; reviewer: string }]
}>()

const confirmedLiters = ref(String(props.record.reportedLiters))
const reviewer = ref('值班管理员')
const hint = ref('')
const outcomeOk = ref(true)

// 每次打开不同记录时重置为该记录自身的申报值，避免沿用上一航班输入
watch(
  () => props.record.id,
  () => {
    confirmedLiters.value = String(props.record.reportedLiters)
    hint.value = ''
  },
)

function submit() {
  hint.value = ''
  emit('submit', { confirmedLiters: Number(confirmedLiters.value), reviewer: reviewer.value })
}

function showOutcome(outcome: ReviewOutcome) {
  outcomeOk.value = outcome.ok
  hint.value = outcome.message
}
defineExpose({ showOutcome })
</script>

<style scoped>
.dialog-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
}
.dialog {
  width: 420px;
  max-width: calc(100vw - 32px);
  background: #fff;
  border-radius: 10px;
  overflow: hidden;
}
.dialog-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
}
.dialog-head h3 {
  margin: 0;
  font-size: 15px;
}
.dialog-body {
  padding: 14px 16px 16px;
}
.record-meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 16px;
  margin: 0 0 12px;
  font-size: 13px;
}
.record-meta dt {
  color: var(--muted);
  font-size: 12px;
}
.record-meta dd {
  margin: 2px 0 0;
}
.review-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.hint {
  margin: 0;
  font-size: 12px;
  color: #067647;
}
.hint.is-warn {
  color: #b42318;
}
</style>
