<script setup lang="ts">
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { NButton, NTag } from 'naive-ui'
import { useUserStore } from '@/stores/user'

const user = useUserStore()

const primaryTo = computed(() =>
  user.isLoggedIn ? { name: 'studio' as const } : { name: 'register' as const },
)
const primaryText = computed(() => (user.isLoggedIn ? '立即开启创作' : '立即开启创作'))
const accountAction = computed(() => (user.isLoggedIn ? '进入工作台' : '免费注册 / 登录账号'))
const accountTo = computed(() =>
  user.isLoggedIn ? { name: 'home' as const } : { name: 'register' as const },
)

const sidebarItems = [
  { label: '首页', to: { name: 'landing' as const }, active: true, icon: '⌂' },
  { label: '视频创作', to: { name: 'studio' as const }, icon: '▣' },
  { label: '数字人', to: { name: 'home' as const }, icon: '◇' },
  { label: '资源库', to: { name: 'resource-library' as const }, icon: '▤' },
  { label: '发布账号', to: { name: 'login' as const }, icon: '⌘' },
]

const creationSteps = [
  {
    no: '01',
    title: '搞定文案',
    desc: '爆款同款脚本，一键提取',
    tone: 'purple',
  },
  {
    no: '02',
    title: '配音 & 数字人',
    desc: '自动配音，AI 驱动形象',
    tone: 'blue',
  },
  {
    no: '03',
    title: '一键成片',
    desc: '字幕、画面、口型自动合成',
    tone: 'amber',
  },
  {
    no: '04',
    title: '自动发布',
    desc: '多平台素材统一管理',
    tone: 'green',
  },
]
</script>

<template>
  <div class="home-shell">
    <aside class="home-sidebar" aria-label="首页导航">
      <RouterLink :to="{ name: 'landing' }" class="brand">
        <span class="brand__mark">K</span>
        <span>
          <strong>数字人创作智能体</strong>
          <small>AI CREATION STUDIO</small>
        </span>
      </RouterLink>

      <nav class="side-nav">
        <RouterLink
          v-for="item in sidebarItems"
          :key="item.label"
          :to="item.to"
          class="side-nav__item"
          :class="{ 'side-nav__item--active': item.active }"
        >
          <span class="side-nav__icon">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar-card">
        <span class="sidebar-card__badge">PRO</span>
        <strong>升级全能创作</strong>
        <small>解锁批量生产与自动分发</small>
      </div>
    </aside>

    <main class="home-main">
      <header class="home-topbar">
        <span class="topbar__hint">为短视频团队打造的 AI 内容工作台</span>
        <div class="topbar__actions">
          <RouterLink :to="{ name: 'login' }">
            <n-button quaternary size="small">下载客户端</n-button>
          </RouterLink>
          <RouterLink :to="accountTo">
            <n-button type="primary" size="small" class="topbar__primary">{{ accountAction }}</n-button>
          </RouterLink>
        </div>
      </header>

      <section class="hero">
        <div class="hero__glow hero__glow--left" />
        <div class="hero__glow hero__glow--right" />

        <div class="hero__copy">
          <n-tag :bordered="false" round class="hero__eyebrow">AI VIDEO CREATION AGENT</n-tag>
          <h1>
            <span>AI,</span>
            <strong>打造超级个体。</strong>
          </h1>
          <p>把文案、数字人、配音、成片和发布串成一条创作流水线，让一个人也能稳定产出短视频内容。</p>
        </div>

        <aside class="collab-card" aria-label="协作入口">
          <span>立即开始协作</span>
          <RouterLink :to="primaryTo">
            <n-button type="primary" round class="collab-card__button">
              立即开启创作
              <span aria-hidden="true">→</span>
            </n-button>
          </RouterLink>
          <div class="collab-card__meta">
            <div class="avatar-stack">
              <span />
              <span />
              <span />
            </div>
            <strong>30,000+</strong>
            <small>团队正在使用</small>
          </div>
        </aside>

        <div class="step-grid" aria-label="AI 创作流程">
          <article
            v-for="step in creationSteps"
            :key="step.no"
            class="step-card"
            :class="`step-card--${step.tone}`"
          >
            <span class="step-card__no">{{ step.no }}</span>
            <h2>{{ step.title }}</h2>
            <p>{{ step.desc }}</p>
            <div class="mock-phone" aria-hidden="true">
              <div class="mock-phone__screen">
                <span />
                <span />
                <span />
              </div>
            </div>
            <RouterLink :to="primaryTo" class="step-card__go" aria-label="进入创作">+</RouterLink>
          </article>
        </div>

        <div class="hero-cta">
          <span>READY TO CREATE?</span>
          <RouterLink :to="primaryTo">
            <n-button type="primary" round size="large" class="hero-cta__button">
              <span class="hero-cta__icon">▭</span>
              {{ primaryText }}
              <span aria-hidden="true">→</span>
            </n-button>
          </RouterLink>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.home-shell {
  --landing-bg: #020605;
  --landing-bg-soft: #06110d;
  --landing-panel: rgba(6, 20, 15, 0.72);
  --landing-panel-strong: rgba(7, 27, 20, 0.88);
  --landing-line: rgba(34, 197, 94, 0.24);
  --landing-line-strong: rgba(22, 242, 139, 0.42);
  --landing-green: #16f28b;
  --landing-green-deep: #00d26a;
  --landing-text: #f2fff8;
  --landing-muted: #86a59a;
  --landing-faint: #4f6f64;
  min-height: 100dvh;
  display: grid;
  grid-template-columns: 156px minmax(0, 1fr);
  color: var(--landing-text);
  font-family: var(--font-sans);
  background:
    radial-gradient(circle at 43% 24%, rgba(22, 242, 139, 0.18), transparent 28%),
    radial-gradient(circle at 74% 26%, rgba(0, 210, 106, 0.12), transparent 26%),
    radial-gradient(circle at 50% 55%, rgba(22, 242, 139, 0.06), transparent 38%),
    linear-gradient(135deg, #000302 0%, var(--landing-bg) 42%, #000000 100%);
}

.home-sidebar {
  position: sticky;
  top: 0;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  padding: 22px 14px;
  border-right: 1px solid rgba(22, 242, 139, 0.12);
  background:
    linear-gradient(180deg, rgba(7, 24, 18, 0.82), rgba(1, 7, 5, 0.92)),
    rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(22px);
  -webkit-backdrop-filter: blur(22px);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--landing-text);
}

.brand__mark {
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  border-radius: 999px;
  color: #ffffff;
  font-size: 12px;
  font-weight: 800;
  background: linear-gradient(135deg, var(--landing-green), #0ea766);
  box-shadow: 0 0 20px rgba(22, 242, 139, 0.34);
}

.brand strong,
.brand small {
  display: block;
  white-space: nowrap;
}

.brand strong {
  font-size: 10px;
  line-height: 1.2;
}

.brand small {
  margin-top: 2px;
  color: var(--landing-faint);
  font-size: 7px;
  letter-spacing: 0.08em;
}

.side-nav {
  display: grid;
  gap: 8px;
  height: 375px;
  margin-top: 36px;
}

.side-nav__item {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 0 10px;
  border-radius: 12px;
  color: var(--landing-muted);
  font-size: 18px;
  font-weight: 600;
  transition:
    color 0.2s ease,
    background 0.2s ease,
    box-shadow 0.2s ease;
}

.side-nav__item:hover,
.side-nav__item--active {
  color: var(--landing-green);
  background: rgba(22, 242, 139, 0.1);
  box-shadow:
    inset 0 0 0 1px rgba(22, 242, 139, 0.14),
    0 0 24px rgba(22, 242, 139, 0.08);
}

.side-nav__icon {
  display: grid;
  width: 18px;
  place-items: center;
  font-size: 13px;
}

.sidebar-card {
  margin-top: auto;
  padding: 14px 12px;
  border: 1px solid var(--landing-line);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(7, 27, 20, 0.86), rgba(2, 9, 7, 0.92));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 18px 42px rgba(0, 0, 0, 0.32);
}

.sidebar-card__badge {
  display: inline-grid;
  min-width: 28px;
  height: 20px;
  place-items: center;
  border-radius: 999px;
  color: var(--landing-green);
  font-size: 10px;
  font-weight: 800;
  background: rgba(22, 242, 139, 0.12);
}

.sidebar-card strong,
.sidebar-card small {
  display: block;
}

.sidebar-card strong {
  margin-top: 8px;
  font-size: 12px;
}

.sidebar-card small {
  margin-top: 4px;
  color: var(--landing-muted);
  font-size: 10px;
  line-height: 1.5;
}

.home-main {
  min-width: 0;
}

.home-topbar {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 18px;
  min-height: 48px;
  padding: 12px 28px 0;
}

.topbar__hint {
  color: var(--landing-muted);
  font-size: 12px;
}

.topbar__actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.topbar__actions :deep(.n-button:not(.topbar__primary)) {
  --n-text-color: var(--landing-muted) !important;
  --n-text-color-hover: var(--landing-green) !important;
  --n-color-hover: rgba(22, 242, 139, 0.08) !important;
  --n-color-pressed: rgba(22, 242, 139, 0.12) !important;
}

.topbar__primary,
.collab-card__button,
.hero-cta__button {
  --n-text-color: #02110a !important;
  --n-text-color-hover: #02110a !important;
  --n-color: transparent !important;
  --n-color-hover: transparent !important;
  --n-color-pressed: transparent !important;
  border: 1px solid rgba(22, 242, 139, 0.32);
  color: #02110a;
  background: linear-gradient(135deg, var(--landing-green), var(--landing-green-deep));
  box-shadow:
    0 0 0 1px rgba(22, 242, 139, 0.14),
    0 14px 34px rgba(22, 242, 139, 0.18);
}

.hero {
  position: relative;
  min-height: calc(100dvh - 48px);
  max-width: 1060px;
  margin: 0 auto;
  padding: 8px 28px 34px;
}

.hero::before,
.hero::after {
  position: absolute;
  z-index: 0;
  pointer-events: none;
  content: '';
  border: 1px solid rgba(22, 242, 139, 0.22);
  border-radius: 50%;
  filter: drop-shadow(0 0 12px rgba(22, 242, 139, 0.18));
}

.hero::before {
  top: 42px;
  left: 12%;
  width: 390px;
  height: 160px;
  transform: rotate(13deg);
  mask-image: linear-gradient(90deg, transparent, #000 18%, #000 78%, transparent);
}

.hero::after {
  top: 80px;
  right: 14%;
  width: 360px;
  height: 118px;
  transform: rotate(-10deg);
  mask-image: linear-gradient(90deg, transparent, #000 22%, #000 72%, transparent);
}

.hero__glow {
  position: absolute;
  z-index: 0;
  border-radius: 999px;
  pointer-events: none;
  filter: blur(8px);
}

.hero__glow--left {
  top: 18px;
  left: 8%;
  width: 430px;
  height: 280px;
  background: rgba(22, 242, 139, 0.18);
}

.hero__glow--right {
  top: 24px;
  right: 2%;
  width: 470px;
  height: 310px;
  background: rgba(0, 210, 106, 0.12);
}

.hero__copy {
  position: relative;
  z-index: 1;
  max-width: 620px;
  margin: 12px 0 0 75px;
  text-align: left;
  transform: translateX(-64px);
}

.hero__eyebrow {
  margin-left: 4px;
  color: var(--landing-green);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.22em;
  border: 1px solid rgba(22, 242, 139, 0.18);
  background: rgba(22, 242, 139, 0.08);
  box-shadow: 0 0 22px rgba(22, 242, 139, 0.12);
}

.hero h1 {
  margin: 10px 0 0;
  font-family: var(--font-display);
  font-size: clamp(54px, 6.6vw, 94px);
  font-weight: 800;
  line-height: 0.92;
  letter-spacing: -0.07em;
}

.hero h1 span,
.hero h1 strong {
  display: block;
}

.hero h1 span {
  color: var(--landing-text);
}

.hero h1 strong {
  margin-top: 20px;
  margin-bottom: 20px;
  color: var(--landing-green);
  text-shadow: 0 0 34px rgba(22, 242, 139, 0.22);
}

.hero__copy p {
  max-width: 480px;
  margin: 10px 0 0 6px;
  color: var(--landing-muted);
  font-size: 13px;
  line-height: 1.8;
}

.collab-card {
  position: absolute;
  z-index: 2;
  top: 54px;
  right: 44px;
  width: 198px;
  padding: 14px;
  border-radius: 22px;
  border: 1px solid var(--landing-line);
  background: linear-gradient(180deg, rgba(8, 28, 21, 0.78), rgba(2, 8, 6, 0.86));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 0 42px rgba(22, 242, 139, 0.13);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.collab-card > span {
  display: block;
  margin-bottom: 8px;
  color: var(--landing-text);
  font-size: 12px;
  font-weight: 700;
}

.collab-card__button {
  width: 100%;
  justify-content: space-between;
}

.collab-card__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 8px;
  border: 1px solid rgba(22, 242, 139, 0.14);
  border-radius: 16px;
  background: rgba(0, 0, 0, 0.26);
}

.avatar-stack {
  display: flex;
}

.avatar-stack span {
  width: 18px;
  height: 18px;
  margin-left: -5px;
  border: 2px solid #07130e;
  border-radius: 999px;
  background: linear-gradient(135deg, #bbf7d0, var(--landing-green));
}

.avatar-stack span:first-child {
  margin-left: 0;
}

.avatar-stack span:nth-child(2) {
  background: linear-gradient(135deg, #86efac, #22c55e);
}

.avatar-stack span:nth-child(3) {
  background: linear-gradient(135deg, #a7f3d0, #10b981);
}

.collab-card__meta strong {
  font-size: 11px;
}

.collab-card__meta small {
  color: var(--landing-muted);
  font-size: 9px;
}

.step-grid {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(150px, 0.86fr) minmax(245px, 1.38fr) minmax(150px, 0.86fr) minmax(
      150px,
      0.86fr
    );
  gap: 16px;
  margin-top: 18px;
  align-items: stretch;
}

.step-card {
  --step-accent: var(--landing-green);
  --step-accent-soft: rgba(22, 242, 139, 0.16);
  position: relative;
  min-height: 214px;
  overflow: hidden;
  padding: 18px 16px;
  border: 1px solid var(--landing-line);
  border-radius: 28px;
  background:
    linear-gradient(180deg, rgba(8, 28, 21, 0.78), rgba(2, 10, 7, 0.86)),
    rgba(0, 0, 0, 0.45);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 18px 44px rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  cursor: pointer;
  transform: translateY(0) scale(1);
  transition:
    border-color 0.28s ease,
    box-shadow 0.28s ease,
    transform 0.32s cubic-bezier(0.2, 0.9, 0.2, 1),
    background 0.28s ease;
}

.step-card::before,
.step-card::after {
  position: absolute;
  pointer-events: none;
  content: '';
  opacity: 0;
  transition:
    opacity 0.28s ease,
    transform 0.42s cubic-bezier(0.2, 0.9, 0.2, 1);
}

.step-card::before {
  inset: -1px;
  border-radius: inherit;
  background:
    radial-gradient(circle at 24% 12%, var(--step-accent-soft), transparent 34%),
    linear-gradient(135deg, rgba(22, 242, 139, 0.08), rgba(255, 255, 255, 0.02));
}

.step-card::after {
  top: -45%;
  left: -80%;
  width: 62%;
  height: 190%;
  background: linear-gradient(105deg, transparent, rgba(22, 242, 139, 0.22), transparent);
  transform: translateX(0) rotate(18deg);
}

.step-card:hover {
  border-color: var(--landing-line-strong);
  background:
    linear-gradient(180deg, rgba(10, 44, 30, 0.9), rgba(3, 14, 9, 0.92)),
    rgba(0, 0, 0, 0.58);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 24px 58px rgba(0, 0, 0, 0.46),
    0 0 0 1px rgba(22, 242, 139, 0.18),
    0 0 42px var(--step-accent-soft);
  transform: translateY(-12px) scale(1.025);
}

.step-card:nth-child(1),
.step-card:nth-child(3),
.step-card:nth-child(4) {
  margin-top: 14px;
}

.step-card:hover::before {
  opacity: 1;
}

.step-card:hover::after {
  opacity: 0.82;
  transform: translateX(410%) rotate(18deg);
}

.step-card--blue {
  --step-accent: #45f7a7;
  --step-accent-soft: rgba(69, 247, 167, 0.16);
}

.step-card--amber {
  --step-accent: #b7f76a;
  --step-accent-soft: rgba(183, 247, 106, 0.14);
}

.step-card--green {
  --step-accent: #21e985;
  --step-accent-soft: rgba(33, 233, 133, 0.16);
}

.step-card__no {
  position: relative;
  z-index: 1;
  color: var(--step-accent);
  font-family: var(--font-en);
  font-size: 13px;
  font-weight: 800;
  transition:
    color 0.28s ease,
    transform 0.28s ease;
}

.step-card--blue .step-card__no {
  color: var(--step-accent);
}

.step-card--amber .step-card__no {
  color: var(--step-accent);
}

.step-card--green .step-card__no {
  color: var(--step-accent);
}

.step-card h2 {
  position: relative;
  z-index: 1;
  margin: 24px 0 0;
  font-family: var(--font-display);
  font-size: 24px;
  line-height: 1.1;
  letter-spacing: -0.05em;
  transition:
    color 0.28s ease,
    transform 0.28s ease;
}

.step-card p {
  position: relative;
  z-index: 1;
  margin: 6px 0 0;
  color: var(--landing-muted);
  font-size: 11px;
  transition:
    color 0.28s ease,
    transform 0.28s ease;
}

.step-card:hover .step-card__no,
.step-card:hover h2,
.step-card:hover p {
  transform: translateY(-3px);
}

.step-card:hover h2 {
  color: var(--step-accent);
}

.step-card:hover p {
  color: var(--landing-text);
}

.mock-phone {
  position: absolute;
  right: 12px;
  bottom: -8px;
  width: 70px;
  height: 112px;
  padding: 7px;
  border-radius: 22px;
  transform: rotate(-8deg);
  background: #07130e;
  box-shadow: 0 16px 28px rgba(0, 0, 0, 0.46);
  transition:
    box-shadow 0.34s ease,
    transform 0.38s cubic-bezier(0.2, 0.9, 0.2, 1),
    right 0.34s ease,
    bottom 0.34s ease;
}

.step-card:nth-child(2) .mock-phone {
  right: 14px;
  bottom: -18px;
  width: 132px;
  height: 148px;
  transform: rotate(7deg);
}

.step-card:nth-child(3) .mock-phone {
  transform: rotate(-12deg);
}

.step-card:nth-child(4) .mock-phone {
  transform: rotate(10deg);
}

.step-card:hover .mock-phone {
  bottom: -2px;
  right: 18px;
  box-shadow:
    0 22px 38px rgba(0, 0, 0, 0.44),
    0 0 32px var(--step-accent-soft);
  transform: rotate(-4deg) scale(1.08);
}

.step-card:nth-child(2):hover .mock-phone {
  right: 8px;
  transform: rotate(4deg) scale(1.08);
}

.step-card:nth-child(3):hover .mock-phone {
  transform: rotate(-7deg) scale(1.08);
}

.step-card:nth-child(4):hover .mock-phone {
  transform: rotate(5deg) scale(1.08);
}

.mock-phone__screen {
  display: grid;
  gap: 5px;
  height: 100%;
  padding: 12px 8px;
  border-radius: 16px;
  background:
    radial-gradient(circle at 50% 20%, rgba(22, 242, 139, 0.26), transparent 20%),
    linear-gradient(180deg, #10241a, #020907);
  transition: background 0.28s ease;
}

.step-card:hover .mock-phone__screen {
  background:
    radial-gradient(circle at 50% 20%, rgba(22, 242, 139, 0.4), transparent 20%),
    linear-gradient(180deg, #143724, #03130c);
}

.mock-phone__screen span {
  height: 8px;
  border-radius: 999px;
  background: rgba(22, 242, 139, 0.62);
}

.mock-phone__screen span:nth-child(2) {
  width: 68%;
  background: rgba(187, 247, 208, 0.88);
}

.mock-phone__screen span:nth-child(3) {
  width: 46%;
  background: rgba(52, 211, 153, 0.78);
}

.step-card__go {
  position: absolute;
  left: 16px;
  bottom: 16px;
  display: grid;
  width: 26px;
  height: 26px;
  place-items: center;
  border-radius: 999px;
  color: #ffffff;
  font-size: 16px;
  font-weight: 700;
  background: rgba(9, 29, 20, 0.9);
  box-shadow: inset 0 0 0 1px var(--landing-line-strong);
  transition:
    background 0.28s ease,
    transform 0.32s cubic-bezier(0.2, 0.9, 0.2, 1),
    box-shadow 0.28s ease;
}

.step-card:hover .step-card__go {
  background: var(--step-accent);
  color: #02110a;
  box-shadow: 0 10px 24px var(--step-accent-soft);
  transform: rotate(135deg) scale(1.08);
}

.hero-cta {
  position: relative;
  z-index: 1;
  display: grid;
  justify-items: center;
  gap: 14px;
  margin-top: 40px;
}

.hero-cta > span {
  color: var(--landing-faint);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.32em;
}

.hero-cta__button {
  --n-text-color: var(--landing-green) !important;
  --n-text-color-hover: var(--landing-green) !important;
  min-width: 270px;
  height: 62px;
  padding: 0 26px;
  border-radius: 18px;
  font-size: 20px;
  font-weight: 800;
  background:
    linear-gradient(135deg, rgba(22, 242, 139, 0.14), rgba(22, 242, 139, 0.04)),
    rgba(0, 0, 0, 0.3);
  color: var(--landing-green);
  box-shadow:
    inset 0 0 0 1px rgba(22, 242, 139, 0.32),
    0 0 34px rgba(22, 242, 139, 0.14);
}

.hero-cta__icon {
  margin-right: 6px;
  font-size: 18px;
}

@media (max-width: 980px) {
  .home-shell {
    grid-template-columns: 1fr;
  }

  .home-sidebar {
    position: relative;
    height: auto;
    flex-direction: row;
    align-items: center;
    gap: 16px;
    padding: 14px 16px;
    overflow-x: auto;
  }

  .side-nav {
    grid-auto-flow: column;
    grid-auto-columns: max-content;
    margin-top: 0;
  }

  .sidebar-card {
    display: none;
  }

  .collab-card {
    position: relative;
    top: auto;
    right: auto;
    width: min(320px, 100%);
    margin: 20px auto 0;
  }

  .hero__copy {
    text-align: center;
  }

  .hero__copy p {
    margin-left: auto;
    margin-right: auto;
  }

  .step-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .home-topbar {
    justify-content: center;
    padding: 12px 12px 0;
  }

  .topbar__hint {
    display: none;
  }

  .hero {
    padding: 12px 14px 36px;
  }

  .hero h1 {
    font-size: clamp(46px, 17vw, 72px);
  }

  .step-grid {
    grid-template-columns: 1fr;
  }

  .hero-cta__button {
    width: min(100%, 320px);
    min-width: 0;
  }
}
</style>
