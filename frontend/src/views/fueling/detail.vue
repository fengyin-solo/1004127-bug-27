<template>
  <section class="page" data-module="fueling-review-detail">
    <header class="page-head">
      <div>
        <h2>加油记录详情</h2>
        <p class="page-desc">详情与复核看板、记录列表共用同一数据源，加油量以记录主档为准，复核差异仅追加留痕。</p>
      </div>
      <div class="page-actions">
        <RouterLink class="btn" :to="{ name: 'fueling' }">返回复核视图</RouterLink>
        <button class="btn" type="button" @click="reload">重试加载</button>
      </div>
    </header>

    <StateBlock v-if="store.loading" message="正在加载加油记录…" retry-text="重新加载" @retry="reload" />
    <!-- 取不到记录：明确空态 + 重试，不回显成上一航班的内容 -->
    <StateBlock
      v-else-if="!record"
      :message="store.errorMessage ? store.errorMessage : '未找到该加油记录，可能已被移除或编号有误'"
      :retry-text="store.errorMessage ? '重试' : '重新加载'"
      extra-text="返回复核视图"
      @retry="reload"
      @extra="goBack"
    />

    <template v-else>
      <div class="detail-grid">
        <article class="detail-card">
          <h3>记录主档</h3>
          <dl>
            <div><dt>加油编号</dt><dd>{{ record.fuelingNo }}</dd></div>
            <div><dt>关联航班</dt><dd>{{ record.flightNo }}</dd></div>
            <div><dt>燃油型号</dt><dd>{{ record.fuelType }}</dd></div>
            <div class="emphasis"><dt>申报加油量</dt><dd>{{ record.reportedLiters }} 升</dd></div>
            <div><dt>加油车号</dt><dd>{{ record.truckNo }}</dd></div>
            <div><dt>加油开始</dt><dd>{{ record.startedAt || '—' }}</dd></div>
            <div><dt>加油结束</dt><dd>{{ record.endedAt || '—' }}</dd></div>
            <div><dt>当前状态</dt><dd><span class="status-tag">{{ record.status }}</span></dd></div>
          </dl>
          <div class="detail-actions">
            <button v-if="record.status === '已完成'" class="btn primary" type="button" @click="openReview">
              复核记录
            </button>
            <p v-else-if="record.status === '已复核'" class="reviewed-tip">
              该记录已完成复核，重复复核只生效一次
            </p>
            <p v-else class="reviewed-tip">记录处于「{{ record.status }}」，完成加油后才能复核</p>
          </div>
        </article>

        <article class="detail-card">
          <h3>复核历史与油量确认</h3>
          <p v-if="!history.length" class="muted-tip">暂无复核记录；历史差异会原样保留，不会覆盖申报加油量。</p>
          <ol v-else class="history-list">
            <li v-for="snapshot in history" :key="snapshot.id" class="history-item">
              <div class="history-head">
                <span class="history-time">{{ snapshot.reviewedAt }}</span>
                <span class="history-badge" :class="snapshot.consistent ? 'ok' : 'warn'">
                  {{ snapshot.consistent ? '油量一致' : `差异 ${formatDelta(snapshot)}` }}
                </span>
              </div>
              <p class="history-line">
                申报 {{ snapshot.reportedLiters }} 升 → 确认 {{ snapshot.confirmedLiters }} 升
              </p>
              <p class="history-line">
                复核人：{{ snapshot.reviewer }} · 台账编号：{{ snapshot.ledgerCode }}（已同步机坪安全台账：
                {{ snapshot.consistent ? '已闭环' : '待整改' }}）
              </p>
            </li>
          </ol>
        </article>
      </div>
    </template>

    <ReviewDialog
      v-if="activeRecord"
      ref="dialogRef"
      :record="activeRecord"
      :submitting="submitting"
      @close="closeReview"
      @submit="submitReview"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import ReviewDialog from './components/ReviewDialog.vue'
import StateBlock from './components/StateBlock.vue'
import type { FuelingRecord, ReviewOutcome } from './review-types'
import { useFuelingReviewStore } from './review-store'

const route = useRoute()
const router = useRouter()
const store = useFuelingReviewStore()

const submitting = ref(false)
const activeRecord = ref<FuelingRecord | null>(null)
const dialogRef = ref<InstanceType<typeof ReviewDialog> | null>(null)

const recordId = computed(() => Number(route.params.id))
// 详情直接读共享 store，不再维护独立缓存，从根上消除列表/详情油量不一致
const record = computed(() =>
  Number.isFinite(recordId.value) ? store.getById(recordId.value) : undefined,
)
const history = computed(() => (record.value ? store.snapshotsOf(record.value.id) : []))

function reload() {
  store.ensureLoaded()
  if (store.loading || !store.loaded) {
    store.load()
  }
}

function goBack() {
  router.push({ name: 'fueling' })
}

function formatDelta(snapshot: { confirmedLiters: number; reportedLiters: number }) {
  const delta = snapshot.confirmedLiters - snapshot.reportedLiters
  return `${delta > 0 ? '+' : ''}${delta} 升`
}

function openReview() {
  if (!record.value) {
    return
  }
  const fresh = store.getById(record.value.id)
  if (!fresh) {
    return
  }
  activeRecord.value = fresh
}

function closeReview() {
  activeRecord.value = null
}

function submitReview(payload: { confirmedLiters: number; reviewer: string }) {
  if (!activeRecord.value || submitting.value) {
    return
  }
  submitting.value = true
  const outcome: ReviewOutcome = store.reviewRecord(activeRecord.value.id, payload)
  submitting.value = false
  if (outcome.ok) {
    activeRecord.value = null
  } else {
    dialogRef.value?.showOutcome(outcome)
    if (outcome.idempotent) {
      activeRecord.value = null
    }
  }
}

watch(
  () => route.params.id,
  () => {
    store.ensureLoaded()
  },
)

onMounted(() => {
  store.ensureLoaded()
})
</script>

<style scoped>
.detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 12px;
}
.detail-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
}
.detail-card h3 {
  margin: 0 0 10px;
  font-size: 14px;
}
.detail-card dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 16px;
  margin: 0;
  font-size: 13px;
}
.detail-card dt {
  color: var(--muted);
  font-size: 12px;
}
.detail-card dd {
  margin: 2px 0 0;
}
.detail-card .emphasis dd {
  font-size: 16px;
  font-weight: 700;
  color: #102a56;
}
.status-tag {
  display: inline-block;
  background: #eef2f7;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 12px;
}
.detail-actions {
  margin-top: 14px;
}
.reviewed-tip,
.muted-tip {
  color: var(--muted);
  font-size: 12px;
  margin: 0;
}
.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.history-item {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
}
.history-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}
.history-time {
  color: var(--muted);
}
.history-badge {
  border-radius: 999px;
  padding: 1px 8px;
}
.history-badge.ok {
  background: #e7f6ee;
  color: #067647;
}
.history-badge.warn {
  background: #fdeceb;
  color: #b42318;
}
.history-line {
  margin: 2px 0;
}
</style>
