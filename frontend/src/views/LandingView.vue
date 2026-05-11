<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { NButton, NTag } from 'naive-ui'
import { useUserStore } from '@/stores/user'

const user = useUserStore()

const primaryTo = computed(() =>
  user.isLoggedIn ? { name: 'studio' as const } : { name: 'register' as const },
)

const primaryText = computed(() => (user.isLoggedIn ? '立即开启创作' : '免费注册 / 登录'))

const creationSteps = [
  {
    no: '01',
    title: '搞定文案',
    desc: '轻松创作优质文案',
    tag: 'EN / CN',
    tone: 'blue',
  },
  {
    no: '02',
    title: '配音 & 数字人',
    desc: '音色克隆与 AI 分身驱动',
    tag: 'AI DRIVING',
    tone: 'teal',
  },
  {
    no: '03',
    title: '一键成片',
    desc: '智能剪辑，快速出片',
    tag: '00:12:45:08',
    tone: 'gold',
  },
  {
    no: '04',
    title: '自动发布',
    desc: '多平台一键分发',
    tag: 'RED / DOUYIN',
    tone: 'mint',
  },
]
</script>

<template>
  <section class="landing page-entrance">
    <div class="landing__hero glass-panel">
      <div class="landing__hero-glow landing__hero-glow--left" />
      <div class="landing__hero-glow landing__hero-glow--right" />

      <div class="landing__copy">
        <n-tag :bordered="false" round class="landing__eyebrow">
          创作中心 / CREATIVE HUB
        </n-tag>
        <h1>
          <span>AI,</span>
          <strong>打造超级个体。</strong>
        </h1>
        <p>
          顶尖 AI 矩阵协作，把文案、配音、数字人、剪辑和发布串成一条丝滑工作流，让一个人也能稳定生产。
        </p>
      </div>

      <aside class="landing__float-card surface-card">
        <span class="landing__float-title">立即开始协作</span>
        <RouterLink :to="primaryTo">
          <n-button type="primary" round class="landing__float-button">{{ primaryText }}</n-button>
        </RouterLink>
        <div class="landing__social-proof">
          <div class="landing__avatars">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>10,000+</strong>
            <small>创作者正在使用</small>
          </div>
        </div>
      </aside>

      <div class="landing__grid">
        <article
          v-for="step in creationSteps"
          :key="step.no"
          :class="['landing-card', `landing-card--${step.tone}`]"
        >
          <div class="landing-card__head">
            <span class="landing-card__no">{{ step.no }}</span>
            <span class="landing-card__line" />
          </div>
          <h2>{{ step.title }}</h2>
          <p>{{ step.desc }}</p>

          <div class="landing-card__visual">
            <div class="landing-card__visual-chip">{{ step.tag }}</div>
            <div class="landing-card__phone">
              <div class="landing-card__screen">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>

          <RouterLink :to="primaryTo" class="landing-card__go" aria-label="进入创作">
            <span>→</span>
          </RouterLink>
        </article>
      </div>

      <div class="landing__cta">
        <span>READY TO CREATE?</span>
        <RouterLink :to="primaryTo">
          <n-button type="primary" round size="large" class="landing__cta-button">
            {{ primaryText }}
          </n-button>
        </RouterLink>
      </div>
    </div>
  </section>
</template>

<style scoped>
.landing {
  min-height: calc(100dvh - 156px);
}

.landing__hero {
  position: relative;
  overflow: hidden;
  min-height: 100%;
  padding: 34px 30px 24px;
}

.landing__hero::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background:
    radial-gradient(circle at 68% 18%, rgba(75, 107, 255, 0.14), transparent 26%),
    linear-gradient(135deg, rgba(255, 255, 255, 0.48), rgba(255, 255, 255, 0.14));
}

.landing__hero-glow {
  position: absolute;
  border-radius: 999px;
  pointer-events: none;
  filter: blur(8px);
}

.landing__hero-glow--left {
  top: 36px;
  left: 7%;
  width: 420px;
  height: 240px;
  background: rgba(75, 107, 255, 0.14);
}

.landing__hero-glow--right {
  top: 22px;
  right: -2%;
  width: 380px;
  height: 280px;
  background: rgba(75, 107, 255, 0.08);
}

.landing__copy,
.landing__grid,
.landing__cta,
.landing__float-card {
  position: relative;
  z-index: 1;
}

.landing__copy {
  max-width: min(720px, calc(100% - 276px));
  margin-top: 6px;
}

.landing__eyebrow {
  color: var(--primary);
  font-family: var(--font-accent);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.2em;
  background: rgba(75, 107, 255, 0.08);
}

.landing h1 {
  margin: 18px 0 0;
  font-family: var(--font-display);
  font-size: clamp(46px, 5.8vw, 84px);
  line-height: 0.9;
  letter-spacing: -0.08em;
}

.landing h1 span,
.landing h1 strong {
  display: block;
}

.landing h1 strong {
  margin-top: 10px;
  color: var(--primary);
  text-shadow: 0 16px 36px rgba(75, 107, 255, 0.2);
}

.landing__copy p {
  max-width: 600px;
  margin: 14px 0 0 4px;
  color: var(--text-sub);
  font-size: 16px;
  line-height: 1.7;
}

.landing__float-card {
  position: absolute;
  top: 34px;
  right: 30px;
  width: 236px;
  padding: 16px;
}

.landing__float-title {
  display: block;
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 700;
}

.landing__float-button {
  width: 100%;
  min-height: 48px;
}

.landing__social-proof {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.66);
}

.landing__avatars {
  display: flex;
}

.landing__avatars span {
  width: 22px;
  height: 22px;
  margin-left: -7px;
  border: 2px solid #ffffff;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
}

.landing__avatars span:first-child {
  margin-left: 0;
}

.landing__avatars span:nth-child(2) {
  background: linear-gradient(135deg, var(--accent-teal), #77d1c9);
}

.landing__avatars span:nth-child(3) {
  background: linear-gradient(135deg, #ffbfc9, #ffdf96);
}

.landing__social-proof strong,
.landing__social-proof small {
  display: block;
}

.landing__social-proof small {
  margin-top: 2px;
  color: var(--text-sub);
}

.landing__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-top: 30px;
}

.landing-card {
  position: relative;
  overflow: hidden;
  min-height: 252px;
  padding: 20px 18px 18px;
  border: 1px solid rgba(255, 255, 255, 0.62);
  border-radius: 28px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.86), rgba(246, 249, 255, 0.8));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    var(--shadow-soft);
}

.landing-card::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background: radial-gradient(circle at 100% 100%, rgba(75, 107, 255, 0.08), transparent 26%);
}

.landing-card:hover {
  border-color: rgba(75, 107, 255, 0.22);
  transform: translateY(-10px) scale(1.01);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.94),
    0 30px 52px rgba(64, 86, 122, 0.18);
}

.landing-card:hover::before {
  background:
    radial-gradient(circle at 100% 100%, rgba(75, 107, 255, 0.14), transparent 28%),
    linear-gradient(160deg, rgba(255, 255, 255, 0.08), rgba(75, 199, 187, 0.08));
}

.landing-card__head {
  display: flex;
  align-items: center;
  gap: 14px;
}

.landing-card__no {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 15px;
  font-family: var(--font-accent);
  font-size: 15px;
  font-weight: 700;
}

.landing-card__line {
  flex: 1;
  height: 1px;
  opacity: 0.6;
}

.landing-card--blue .landing-card__no {
  color: var(--primary);
  background: rgba(75, 107, 255, 0.12);
}

.landing-card--blue .landing-card__line {
  background: rgba(75, 107, 255, 0.22);
}

.landing-card--teal .landing-card__no {
  color: var(--accent-teal);
  background: rgba(75, 199, 187, 0.14);
}

.landing-card--teal .landing-card__line {
  background: rgba(75, 199, 187, 0.22);
}

.landing-card--gold .landing-card__no {
  color: var(--accent-gold);
  background: rgba(239, 177, 75, 0.16);
}

.landing-card--gold .landing-card__line {
  background: rgba(239, 177, 75, 0.22);
}

.landing-card--mint .landing-card__no {
  color: #21a781;
  background: rgba(75, 199, 187, 0.12);
}

.landing-card--mint .landing-card__line {
  background: rgba(75, 199, 187, 0.18);
}

.landing-card h2 {
  margin: 18px 0 0;
  font-family: var(--font-display);
  font-size: clamp(24px, 2vw, 30px);
  line-height: 1.02;
  letter-spacing: -0.06em;
}

.landing-card p {
  max-width: 14ch;
  margin: 8px 0 0;
  color: var(--text-sub);
  font-size: 14px;
  line-height: 1.55;
}

.landing-card__visual {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 42%;
  height: 60%;
}

.landing-card__visual-chip {
  position: absolute;
  right: 16px;
  top: 8px;
  padding: 7px 10px;
  border-radius: 999px;
  color: var(--primary);
  font-family: var(--font-accent);
  font-size: 11px;
  letter-spacing: 0.08em;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: 0 12px 24px rgba(64, 86, 122, 0.08);
}

.landing-card__phone {
  position: absolute;
  right: 12px;
  bottom: -4px;
  width: 116px;
  height: 182px;
  padding: 8px;
  border-radius: 28px;
  transform: rotate(8deg);
  background: linear-gradient(180deg, #fdfefe, #dde8fb);
  box-shadow: 0 22px 48px rgba(64, 86, 122, 0.18);
}

.landing-card:nth-child(odd) .landing-card__phone {
  transform: rotate(-8deg);
}

.landing-card:hover .landing-card__phone {
  transform: translateY(-10px) rotate(3deg);
}

.landing-card:nth-child(odd):hover .landing-card__phone {
  transform: translateY(-10px) rotate(-3deg);
}

.landing-card__screen {
  display: grid;
  gap: 8px;
  height: 100%;
  padding: 14px 12px;
  border-radius: 22px;
  background:
    radial-gradient(circle at 30% 18%, rgba(75, 107, 255, 0.22), transparent 22%),
    linear-gradient(180deg, #e8f1ff, #eef5ff 72%, #dde8fb);
}

.landing-card__screen span {
  height: 10px;
  border-radius: 999px;
  background: rgba(75, 107, 255, 0.78);
}

.landing-card__screen span:nth-child(2) {
  width: 72%;
  background: rgba(75, 199, 187, 0.72);
}

.landing-card__screen span:nth-child(3) {
  width: 44%;
  background: rgba(75, 107, 255, 0.46);
}

.landing-card__go {
  position: absolute;
  left: 18px;
  bottom: 18px;
  display: grid;
  width: 44px;
  height: 44px;
  place-items: center;
  border-radius: 999px;
  color: var(--text-inverse);
  background: var(--bg-dark);
  box-shadow: var(--shadow-dark);
}

.landing-card__go span {
  font-size: 18px;
}

.landing-card:hover .landing-card__go {
  background: linear-gradient(135deg, var(--primary), var(--accent-teal));
  transform: translateX(4px);
}

.landing__cta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  margin-top: 22px;
}

.landing__cta > span {
  color: var(--text-light);
  font-family: var(--font-accent);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.28em;
}

.landing__cta-button {
  min-width: 240px;
  min-height: 52px;
}

@media (max-width: 1180px) {
  .landing__float-card {
    position: relative;
    top: auto;
    right: auto;
    width: min(320px, 100%);
    margin: 28px 0 0 auto;
  }

  .landing__copy {
    max-width: 680px;
  }

  .landing__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .landing-card {
    min-height: 300px;
  }

  .landing-card h2 {
    font-size: 36px;
  }

  .landing-card p {
    max-width: 15ch;
    font-size: 16px;
  }

  .landing-card__phone {
    width: 148px;
    height: 226px;
  }

  .landing__cta {
    display: grid;
    justify-items: center;
  }
}

@media (max-width: 900px) {
  .landing__hero {
    padding: 26px 18px;
  }

  .landing__grid {
    grid-template-columns: 1fr;
  }

  .landing-card {
    min-height: 320px;
  }

  .landing__copy {
    max-width: 100%;
  }
}

@media (max-width: 640px) {
  .landing h1 {
    font-size: clamp(46px, 16vw, 72px);
  }

  .landing__copy p,
  .landing-card p {
    font-size: 15px;
  }

  .landing-card h2 {
    font-size: 32px;
  }

  .landing-card__visual {
    width: 46%;
  }

  .landing__cta-button {
    width: min(100%, 320px);
    min-width: 0;
  }
}
</style>
