<template>
  <section class="page" data-module="fueling-review">
    <header class="page-head">
      <div>
        <h2>航空加油复核</h2>
        <p class="page-desc">看板、列表与详情共用同一份加油数据：按加油车号定位记录，核对加油量后复核，结果同步机坪安全台账。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="reload">重新加载</button>
        <button class="btn" type="button" @click="goList">返回加油列表</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="board-row">
      <section class="board-card">
        <h3 class="board-title">待复核（{{ pendingRows.length }}）</h3>
        <ul class="board-list">
          <li
            v-for="row in pendingRows"
            :key="String(row.id)"
            :class="{ active: Number(row.id) === selectedId }"
            @click="select(row)"
          >
            <span>{{ row['加油编号'] }} · {{ row['关联航班'] }}</span>
            <span>车号 {{ row['加油车号'] }} · 油量 {{ row['加油量'] }} · {{ row.status }}</span>
          </li>
          <li v-if="!pendingRows.length" class="board-empty">没有待复核的加油记录</li>
        </ul>
      </section>
      <section class="board-card">
        <h3 class="board-title">已完成看板（{{ reviewedRows.length }}）</h3>
        <ul class="board-list">
          <li
            v-for="row in reviewedRows"
            :key="String(row.id)"
            :class="{ active: Number(row.id) === selectedId }"
            @click="select(row)"
          >
            <span>{{ row['加油编号'] }} · {{ row['关联航班'] }}</span>
            <span>车号 {{ row['加油车号'] }} · 油量 {{ row['加油量'] }} · {{ row.status }}</span>
          </li>
          <li v-if="!reviewedRows.length" class="board-empty">已完成看板只收录已复核记录</li>
        </ul>
      </section>
    </div>

    <div class="review-body">
      <div class="review-list">
        <table class="data-table">
          <thead>
            <tr>
              <th v-for="column in columns" :key="column">{{ column }}</th>
              <th>当前状态</th>
              <th>可执行动作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="String(row.id)"
              :class="{ selected: Number(row.id) === selectedId }"
              @click="select(row)"
            >
              <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
              <td>{{ row.status }}</td>
              <td class="row-actions">
                <button class="link" type="button" @click.stop="select(row)">详情</button>
                <button
                  v-if="String(row.status) !== reviewedStatus"
                  class="link"
                  type="button"
                  @click.stop="review(row)"
                >
                  复核记录
                </button>
              </td>
            </tr>
            <tr v-if="!rows.length && !loadFailed">
              <td :colspan="columns.length + 2" class="empty-state">没有匹配的加油记录，可调整筛选条件</td>
            </tr>
            <tr v-if="loadFailed">
              <td :colspan="columns.length + 2" class="empty-state">
                加油记录暂时取不到
                <button class="link" type="button" @click="reload">重试</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <aside class="review-detail">
        <template v-if="detail">
          <h3 class="detail-title">加油详情 · {{ detail['加油编号'] }}</h3>
          <dl class="detail-grid">
            <div v-for="column in columns" :key="column" class="detail-item">
              <dt>{{ column }}</dt>
              <dd>{{ detail[column] ?? '—' }}</dd>
            </div>
            <div class="detail-item">
              <dt>当前状态</dt>
              <dd>{{ detail.status }}</dd>
            </div>
          </dl>
          <button
            class="btn primary"
            type="button"
            :disabled="String(detail.status) === reviewedStatus"
            @click="review(detail)"
          >
            {{ String(detail.status) === reviewedStatus ? '已复核，无需重复操作' : '复核记录' }}
          </button>
        </template>
        <template v-else-if="selectedId !== null">
          <p class="empty-state">取不到编号为 {{ selectedId }} 的加油记录，可能已被移除。</p>
          <button class="btn" type="button" @click="refreshDetail">重试</button>
        </template>
        <template v-else>
          <p class="empty-state">从看板或列表选择一条加油记录查看详情</p>
        </template>
      </aside>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条航空加油记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  getEntry,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('fueling')
const router = useRouter()

// 看板、列表、详情围绕同一组字段与状态，全部经 local-service 读同一份数据。
const columns = [...meta.fields]
const reviewedStatus = '已复核'
const reviewAction = '复核记录'
const filterFields = ['加油车号', '关联航班', '加油编号']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const loadFailed = ref(false)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const selectedId = ref<number | null>(null)
const detail = ref<EntryRow | null>(null)

// 看板分类只认当前状态：按加油车号过滤也不会把未复核记录排进已完成看板。
const pendingRows = computed(() => rows.value.filter((row) => String(row.status) !== reviewedStatus))
const reviewedRows = computed(() => rows.value.filter((row) => String(row.status) === reviewedStatus))
const stats = computed(() => [
  { label: '待复核记录', value: pendingRows.value.length },
  { label: '已完成看板', value: reviewedRows.value.length },
  { label: '当前筛选结果', value: total.value },
])

function goList() {
  router.push('/fueling')
}

function resetFilters() {
  filters.value = {}
  reload()
}

function select(row: EntryRow) {
  selectedId.value = Number(row.id)
  refreshDetail()
}

function refreshDetail() {
  // 详情与列表同源：每次都回仓库取最新一行，取不到就交给空态。
  if (selectedId.value === null) {
    return
  }
  detail.value = getEntry(meta.key, selectedId.value)
}

function review(row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), reviewAction)
  if (!result.ok) {
    // 重复复核只生效一次：本地服务会拒绝并说明原因。
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  loadFailed.value = false
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    rows.value = []
    total.value = 0
    loadFailed.value = true
    errorMessage.value = error instanceof Error ? error.message : '航空加油列表读取失败'
  }
  refreshDetail()
}

onMounted(reload)
</script>
