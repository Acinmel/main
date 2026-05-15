<template>
  <section class="config-panel">
    <div class="panel-main">
      <div class="panel-title">
        <span class="line-icon">▣</span>
        <div>
          <strong>分镜素材</strong>
          <small v-if="enabled">已配置 1 个素材</small>
        </div>
      </div>
      <div class="panel-actions">
        <button class="configure-btn" type="button" @click="$emit('configure')">配置 &gt;</button>
        <button
          class="switch"
          :class="{ active: enabled }"
          type="button"
          aria-label="分镜素材开关"
          @click="$emit('update:enabled', !enabled)"
        >
          <span />
        </button>
      </div>
    </div>

    <div class="materials-row">
      <button class="add-card" type="button" @click="$emit('configure')">
        <span>+</span>
        <b>添加</b>
      </button>
      <div class="material-thumb">
        <img v-if="thumbnailUrl" :src="thumbnailUrl" alt="分镜素材" />
        <div v-else class="material-fallback" />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  enabled: boolean
  thumbnailUrl?: string
}>()

defineEmits<{
  (event: 'update:enabled', value: boolean): void
  (event: 'configure'): void
}>()
</script>

<style scoped>
.config-panel {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.panel-main,
.panel-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text-main);
  min-width: 0;
}

.panel-title strong {
  display: block;
  font-size: var(--font-section-title, 15px);
  font-weight: 800;
}

.panel-title small {
  display: block;
  margin-top: 3px;
  color: #94A3B8;
  font-size: var(--font-small, 12px);
  font-weight: 700;
}

.line-icon {
  color: #94A3B8;
  font-size: 18px;
}

.configure-btn {
  border: 0;
  color: var(--primary);
  font-size: var(--font-small, 12px);
  font-weight: 800;
  background: transparent;
  cursor: pointer;
}

.switch {
  position: relative;
  width: 38px;
  height: 22px;
  border: 0;
  border-radius: 999px;
  background: #CBD5E1;
  cursor: pointer;
  transition: background 0.18s ease;
}

.switch span {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  background: #fff;
  box-shadow: 0 4px 10px rgba(15, 23, 42, 0.18);
  transition: transform 0.18s ease;
}

.switch.active {
  background: var(--primary);
}

.switch.active span {
  transform: translateX(16px);
}

.materials-row {
  display: flex;
  gap: 10px;
  min-width: 0;
  padding-left: 30px;
}

.add-card,
.material-thumb {
  width: 82px;
  height: 82px;
  flex: 0 0 82px;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 12px;
}

.add-card {
  display: grid;
  place-items: center;
  border: 1px dashed #CBD5E1;
  color: #94A3B8;
  background: #fff;
  cursor: pointer;
}

.add-card span {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 999px;
  color: #94A3B8;
  font-size: 22px;
  background: #F8FAFC;
}

.add-card b {
  margin-top: -10px;
  font-size: var(--font-small, 12px);
}

.material-thumb {
  border: 1px solid #E2E8F0;
  background: #F8FAFC;
  box-shadow: 0 10px 22px rgba(15, 23, 42, 0.08);
}

.material-thumb img,
.material-fallback {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.material-fallback {
  background:
    radial-gradient(circle at 30% 30%, rgba(124, 58, 237, 0.16), transparent 30%),
    linear-gradient(135deg, #DCFCE7, #F8FAFC 55%, #FEF3C7);
}

@media (max-width: 1500px) {
  .panel-title strong {
    font-size: 14px;
  }

  .materials-row {
    padding-left: 28px;
  }

  .add-card,
  .material-thumb {
    width: 78px;
    height: 78px;
    flex-basis: 78px;
  }
}
</style>
