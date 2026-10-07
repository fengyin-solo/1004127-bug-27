<template>
  <section class="page" data-module="fueling-review">
    <header class="page-head">
      <div>
        <h2>航空加油复核</h2>
        <p class="page-desc">
          看板、列表与详情共用同一数据源；按加油车号定位时只按记录自身状态归列，未复核记录不会进入已完成/已复核看板。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn ghost" type="button" @click="reload">刷新数据</button>
        <button class="btn" type="button" @click="resetSamples">恢复示例数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent>
      <label class="filter-item">
        <span>关联航班</span>
        <input v-model="filters.flightNo" placeholder="按航班号检索，如 CA1858" />
      </label>
      <label class="filter-item">
        <span>加油车号</span>
        <input v-model="filters.truckNo" placeholder="按加油车号定位，如 FY-312" />
      </label>
      <label class="filter-item">
        <span>加油编号</span>
        <input v-model="filters.fuelingNo" placeholder="按加油编号检索" />
      </label>
      <button class="btn" type="button" @click="clearFilters">清空条件</button>
    </form>

    <div class="view-tabs" role="tablist">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: viewMode === tab.key }"
        type="button"
        role="tab"
        @click="viewMode = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <StateBlock
      v-if="store.loading"
      :message="'正在加载加油复核数据…'"
      :retry-text="'重新加载'"
      @retry="reload"
    />
    <StateBlock
      v-else-if="store.errorMessage"
      :message="store.errorMessage"
      :retry-text="'重试'"
      extra-text="恢复示例数据"
      @retry="reload"
      @extra="resetSamples"
    />

    <template v-else>
      <!-- 看板视图：列分组严格等于状态，过滤命中的未复核记录仍留在自己的状态列 -->
      <div v-if="viewMode === 'board'" class="board">
        <section v-for="status in statuses" :key="status" class="board-column">
          <header class="column-head">
            <span>{{ status }}</span>
            <em>{{ grouped[status].length }}</em>
          </header>
          <div v-if="grouped[status].length" class="column-list">
            <FuelCard v-for="record in grouped[status]" :key="record.id" :record="record" @review="openReview" />
          </div>
          <p v-else class="column-empty">暂无记录</p>
        </section>
      </div>

      <!-- 列表视图：与看板、详情读取同一份 filtered 数据 -->
      <template v-else>
        <table v-if="filtered.length" class="data-table">
          <thead>
            <tr>
              <th v-for="column in columns" :key="column">{{ column }}</th>
              <th>当前状态</th>
              <th>可执行动作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in filtered" :key="row.id">
              <td>{{ row.fuelingNo }}</td>
              <td>{{ row.flightNo }}</td>
              <td>{{ row.fuelType }}</td>
              <td>{{ row.reportedLiters }} 升</td>
              <td>{{ row.truckNo }}</td>
              <td>{{ row.startedAt || '—' }}</td>
              <td>{{ row.endedAt || '—' }}</td>
              <td>{{ row.status }}</td>
              <td class="row-actions">
                <RouterLink class="link" :to="{ name: 'fueling-review-detail', params: { id: row.id } }">
                  详情
                </RouterLink>
                <button v-if="row.status === '已完成'" class="link" type="button" @click="openReview(row)">
                  复核记录
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <StateBlock
          v-else
          :message="hasActiveFilter ? '没有符合筛选条件的加油记录' : '暂无加油记录'"
          :retry-text="hasActiveFilter ? '清空筛选条件' : '重新加载'"
          @retry="hasActiveFilter ? clearFilters() : reload()"
        />
      </template>
    </template>

    <footer class="page-foot">
      <span>
        共 {{ filtered.length }} 条记录（全部 {{ store.records.length }} 条）·
        待整改油量差异 {{ store.pendingDiscrepancyCount }} 条
      </span>
      <span v-if="actionMessage" class="action-msg" :class="{ 'is-warn': !actionOk }">
        {{ actionMessage }}
      </span>
    </footer>

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
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'

import FuelCard from './components/FuelCard.vue'
import ReviewDialog from './components/ReviewDialog.vue'
import StateBlock from './components/StateBlock.vue'
import { FUELING_STATUSES } from './review-types'
import type { FuelingRecord, FuelingStatus, ReviewOutcome } from './review-types'
import { useFuelingReviewStore } from './review-store'

const store = useFuelingReviewStore()
const route = useRoute()

const columns = ['加油编号', '关联航班', '燃油型号', '加油量', '加油车号', '加油开始', '加油结束']
const statuses = FUELING_STATUSES
const tabs = [
  { key: 'board', label: '复核看板' },
  { key: 'list', label: '记录列表' },
] as const

const viewMode = ref<(typeof tabs)[number]['key']>('board')
const filters = reactive({ flightNo: '', truckNo: '', fuelingNo: '' })
const activeRecord = ref<FuelingRecord | null>(null)
const submitting = ref(false)
const actionMessage = ref('')
const actionOk = ref(true)
const dialogRef = ref<InstanceType<typeof ReviewDialog> | null>(null)

const filtered = computed<FuelingRecord[]>(() => store.filteredRecords(filters))
const hasActiveFilter = computed(
  () => !!(filters.flightNo.trim() || filters.truckNo.trim() || filters.fuelingNo.trim()),
)

// 看板按「过滤后的同一份结果」再按状态分组：按车号定位时未复核记录不会被排进已完成列
const grouped = computed(() => {
  const result = Object.fromEntries(
    statuses.map((status) => [status, [] as FuelingRecord[]]),
  ) as Record<FuelingStatus, FuelingRecord[]>
  for (const record of filtered.value) {
    result[record.status].push(record)
  }
  return result
})

const statCards = computed(() => [
  { label: '待加油', value: store.byStatus['待加油'].length },
  { label: '加油中', value: store.byStatus['加油中'].length },
  { label: '待复核（已完成）', value: store.byStatus['已完成'].length },
  { label: '已复核', value: store.byStatus['已复核'].length },
])

function reload() {
  actionMessage.value = ''
  store.load()
}

function resetSamples() {
  store.resetSamples()
  actionOk.value = true
  actionMessage.value = '已恢复为示例数据'
}

function clearFilters() {
  filters.flightNo = ''
  filters.truckNo = ''
  filters.fuelingNo = ''
}

function openReview(record: FuelingRecord) {
  // 提交前再次从共享源取最新记录，防止看板上是旧状态
  const fresh = store.getById(record.id)
  if (!fresh) {
    actionOk.value = false
    actionMessage.value = '记录已不存在，请刷新后重试'
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
  const target = activeRecord.value
  // 重复复核只生效一次：store 内部按状态幂等拦截
  const outcome: ReviewOutcome = store.reviewRecord(target.id, payload)
  submitting.value = false
  if (outcome.ok) {
    actionOk.value = true
    actionMessage.value = outcome.message
    activeRecord.value = null
  } else {
    actionOk.value = false
    actionMessage.value = outcome.message
    dialogRef.value?.showOutcome(outcome)
    if (outcome.idempotent) {
      activeRecord.value = null
    }
  }
}

onMounted(() => {
  // 支持 /fueling?truckNo=FY-312 这类「按加油车号定位」入口
  const truck = route.query.truckNo
  if (typeof truck === 'string' && truck.trim()) {
    filters.truckNo = truck.trim()
  }
  const flight = route.query.flightNo
  if (typeof flight === 'string' && flight.trim()) {
    filters.flightNo = flight.trim()
  }
  store.ensureLoaded()
})
</script>

<style scoped>
.view-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 10px;
}
.tab-btn {
  border: 1px solid var(--border);
  background: #fff;
  border-radius: 6px 6px 0 0;
  padding: 6px 14px;
  cursor: pointer;
  font-size: 13px;
}
.tab-btn.active {
  background: var(--brand);
  border-color: var(--brand);
  color: #fff;
}
.board {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.board-column {
  background: #eef2f7;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  min-height: 220px;
}
.column-head {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  padding: 2px 4px 8px;
}
.column-head em {
  font-style: normal;
  color: var(--muted);
}
.column-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.column-empty {
  margin: 0;
  text-align: center;
  color: var(--muted);
  font-size: 12px;
  padding: 18px 0;
}
.action-msg {
  color: #067647;
}
.action-msg.is-warn {
  color: #b42318;
}
</style>
