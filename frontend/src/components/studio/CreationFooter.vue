<template>
  <footer class="creation-footer">
    <div class="footer-progress">
      <span>创作进度</span>
      <strong>{{ progressText || '3/4' }}</strong>
      <div class="progress-track">
        <i :style="{ width: `${Math.min(100, Math.max(0, percentage || 75))}%` }" />
      </div>
    </div>

    <div class="footer-actions">
      <button class="prev-btn" type="button" @click="$emit('previous')">上一步</button>
      <button class="next-btn" type="button" @click="$emit('next')">下一步</button>
    </div>
  </footer>
</template>

<script setup lang="ts">
defineProps<{
  progressText?: string
  percentage?: number
}>()

defineEmits<{
  (event: 'previous'): void
  (event: 'next'): void
}>()
</script>

<style scoped>
.creation-footer {
  position: fixed;
  z-index: 40;
  right: 0;
  bottom: 0;
  left: var(--shell-sidebar-width, 0px);
  display: flex;
  height: var(--footer-height, 72px);
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  border-top: 1px solid var(--border, #E5E7EB);
  padding: 0 24px;
  background: #fff;
  box-shadow: 0 -10px 28px rgba(15, 23, 42, 0.04);
}

.footer-progress {
  display: grid;
  gap: 3px;
  min-width: 160px;
}

.footer-progress span {
  color: #94A3B8;
  font-size: 12px;
  font-weight: 800;
}

.footer-progress strong {
  color: var(--primary, #7C3AED);
  font-size: 14px;
  font-weight: 900;
}

.progress-track {
  width: 140px;
  height: 6px;
  overflow: hidden;
  border-radius: 999px;
  background: #E5E7EB;
}

.progress-track i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #7C3AED, #8B5CF6);
}

.footer-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}

.footer-actions button {
  min-width: 104px;
  height: 44px;
  border-radius: 14px;
  padding: 0 22px;
  font-size: 15px;
  font-weight: 900;
  cursor: pointer;
}

.prev-btn {
  border: 0;
  color: #64748B;
  background: #F1F5F9;
}

.next-btn {
  border: 1px solid var(--primary, #7C3AED);
  color: var(--primary, #7C3AED);
  background: #fff;
}

.next-btn:hover {
  color: #fff;
  background: var(--primary, #7C3AED);
}

@media (max-width: 980px) {
  .creation-footer {
    left: 0;
    padding: 0 16px;
  }

  .footer-actions button {
    min-width: 96px;
    height: 42px;
    font-size: 14px;
  }
}
</style>
