<template>
  <section class="config-panel">
    <div class="panel-main">
      <div class="panel-title">
        <span class="line-icon">▥</span>
        <strong>背景音乐</strong>
      </div>
      <button
        class="switch"
        :class="{ active: enabled }"
        type="button"
        aria-label="背景音乐开关"
        @click="$emit('update:enabled', !enabled)"
      >
        <span />
      </button>
    </div>

    <div class="music-bar">
      <button class="play-btn" type="button">▶</button>
      <select :value="musicId" @change="$emit('update:musicId', ($event.target as HTMLSelectElement).value)">
        <option value="cozy_vibes">Cozy Vibes</option>
        <option value="lucky_talk">起风了</option>
        <option value="clean_loop">Clean Loop</option>
      </select>
      <button class="upload-btn" type="button" @click="$emit('upload')">↥</button>
      <span class="volume-icon">◔</span>
      <input
        class="volume-range"
        type="range"
        min="0"
        max="1"
        step="0.01"
        :value="volume"
        @input="$emit('update:volume', Number(($event.target as HTMLInputElement).value))"
      />
      <div class="volume-stepper">
        <button type="button" @click="$emit('update:volume', Math.max(0, volume - 0.01))">-</button>
        <span>{{ volume.toFixed(2) }}</span>
        <button type="button" @click="$emit('update:volume', Math.min(1, volume + 0.01))">+</button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  enabled: boolean
  musicId: string
  volume: number
}>()

defineEmits<{
  (event: 'update:enabled', value: boolean): void
  (event: 'update:musicId', value: string): void
  (event: 'update:volume', value: number): void
  (event: 'upload'): void
}>()
</script>

<style scoped>
.config-panel {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.panel-main {
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
  font-size: var(--font-section-title, 15px);
  font-weight: 800;
}

.line-icon {
  color: #94A3B8;
  font-size: 19px;
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

.music-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 36px;
  padding-left: 28px;
  flex-wrap: nowrap;
}

.play-btn,
.upload-btn {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 30px;
  place-items: center;
  border: 0;
  border-radius: 999px;
  color: var(--primary);
  font-size: var(--font-small, 12px);
  font-weight: 900;
  background: var(--primary-light);
  cursor: pointer;
}

select {
  height: 34px;
  flex: 1 1 auto;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 0 10px;
  color: #475569;
  font-size: var(--font-small, 12px);
  font-weight: 700;
  outline: none;
  background: #fff;
}

.volume-icon {
  flex: 0 0 auto;
  color: #94A3B8;
}

.volume-range {
  width: min(72px, 18%);
  max-width: 110px;
  min-width: 42px;
  flex: 0 1 72px;
  accent-color: var(--primary);
}

.volume-stepper {
  display: grid;
  grid-template-columns: 20px minmax(32px, 1fr) 20px;
  width: 74px;
  flex: 0 0 74px;
  height: 34px;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: #fff;
}

.volume-stepper button {
  border: 0;
  color: #94A3B8;
  background: transparent;
  cursor: pointer;
}

.volume-stepper span {
  color: #475569;
  text-align: center;
  font-size: 11px;
  font-weight: 900;
}

@media (max-width: 1500px) {
  .panel-title {
    font-size: 14px;
  }

  .music-bar {
    gap: 6px;
    padding-left: 28px;
  }

  .volume-range {
    width: min(70px, 18%);
    min-width: 44px;
    flex-basis: 70px;
  }

  .volume-stepper {
    width: 72px;
    flex-basis: 72px;
  }
}
</style>
