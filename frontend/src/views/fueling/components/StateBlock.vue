<template>
  <div class="state-block" :class="{ 'is-error': !!message }">
    <p class="state-text">{{ message }}</p>
    <div class="state-actions">
      <button class="btn primary" type="button" @click="$emit('retry')">{{ retryText }}</button>
      <button v-if="extraText" class="btn" type="button" @click="$emit('extra')">
        {{ extraText }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// 列表、看板、详情共用的空/错态：取不到记录时都给一条明确的重试出口。
withDefaults(
  defineProps<{
    message: string
    retryText?: string
    extraText?: string
  }>(),
  {
    retryText: '重试',
    extraText: '',
  },
)
defineEmits<{
  retry: []
  extra: []
}>()
</script>

<style scoped>
.state-block {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 36px 16px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  background: #fff;
  color: var(--muted);
}
.state-block.is-error {
  border-color: #f0a8a0;
  background: #fdf6f5;
  color: #b42318;
}
.state-text {
  margin: 0;
  font-size: 13px;
}
.state-actions {
  display: flex;
  gap: 8px;
}
</style>
