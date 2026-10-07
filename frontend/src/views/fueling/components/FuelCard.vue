<template>
  <article class="fuel-card" data-status="card">
    <div class="card-head">
      <RouterLink class="card-no" :to="{ name: 'fueling-review-detail', params: { id: record.id } }">
        {{ record.fuelingNo }}
      </RouterLink>
      <span class="card-flight">{{ record.flightNo }}</span>
    </div>
    <dl class="card-body">
      <div><dt>加油车号</dt><dd>{{ record.truckNo }}</dd></div>
      <div><dt>燃油型号</dt><dd>{{ record.fuelType }}</dd></div>
      <!-- 加油量只从共享 store 的当前记录读取，避免渲染成上一航班的值 -->
      <div><dt>申报加油量</dt><dd class="liters">{{ record.reportedLiters }} 升</dd></div>
      <div><dt>加油时间</dt><dd>{{ record.startedAt || '—' }}</dd></div>
    </dl>
    <footer class="card-foot">
      <RouterLink class="link" :to="{ name: 'fueling-review-detail', params: { id: record.id } }">
        查看详情
      </RouterLink>
      <button v-if="record.status === '已完成'" class="link" type="button" @click="$emit('review', record)">
        复核记录
      </button>
    </footer>
  </article>
</template>

<script setup lang="ts">
import type { FuelingRecord } from '../review-types'

defineProps<{ record: FuelingRecord }>()
defineEmits<{ review: [record: FuelingRecord] }>()
</script>

<style scoped>
.fuel-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.card-no {
  font-weight: 600;
  color: var(--brand);
  text-decoration: none;
  font-size: 13px;
}
.card-flight {
  font-size: 12px;
  color: var(--muted);
}
.card-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 12px;
  margin: 0;
  font-size: 12px;
}
.card-body dt {
  color: var(--muted);
}
.card-body dd {
  margin: 1px 0 0;
}
.card-body .liters {
  font-weight: 600;
}
.card-foot {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  border-top: 1px dashed var(--border);
  padding-top: 6px;
}
</style>
