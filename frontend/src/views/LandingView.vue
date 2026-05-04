<script setup lang="ts">
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/inter/800.css'
import '@fontsource/rajdhani/500.css'
import '@fontsource/rajdhani/600.css'
import '@fontsource/rajdhani/700.css'
import '@fontsource/sora/600.css'
import '@fontsource/sora/700.css'
import '@fontsource/sora/800.css'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { NButton, NCard, NTag, NText } from 'naive-ui'
import { useUserStore } from '@/stores/user'

const user = useUserStore()

const primaryTo = computed(() =>
  user.isLoggedIn ? { name: 'home' as const } : { name: 'register' as const },
)
const primaryText = computed(() => (user.isLoggedIn ? '进入工作台' : '免费开始生成'))

const features = [
  {
    title: '自拍生成专属数字人',
    desc: '上传一张清晰自拍，选择职业形象或风格，生成可用于短视频口播的半身数字人。',
  },
  {
    title: '口播文案提取与改写',
    desc: '从视频链接或素材中提取口播内容，再用 AI 优化为适合复刻表达的脚本。',
  },
  {
    title: '一站式视频预览',
    desc: '从形象、文案到口播成片预览集中完成，减少多工具切换和反复上传。',
  },
]

const workflow = ['创建数字人', '输入原视频', '提取/改写文案', '生成口播预览']

const personas = ['律师版', '程序员版', '财务版', '厨师版', '西装版', '古风版', '时尚版']
</script>

<template>
  <div class="landing">
    <section class="landing__hero">
      <div class="landing__hero-copy">
        <n-tag :bordered="false" class="landing__eyebrow">AI VIDEO GENERATION WORKBENCH</n-tag>
        <h1>用 AI 数字人，把爆款口播快速重制成你的成片</h1>
        <p class="landing__lead">
          深色沉浸工作台、专属数字人形象、口播文案提取与 AI 改写，让短视频复刻从素材分析到预览生成更顺滑。
        </p>

        <div class="landing__actions">
          <RouterLink :to="primaryTo">
            <n-button type="primary" size="large" class="landing__cta">
              {{ primaryText }}
            </n-button>
          </RouterLink>
          <RouterLink :to="{ name: 'login' }">
            <n-button size="large" secondary>登录已有账号</n-button>
          </RouterLink>
        </div>

        <div class="landing__proof">
          <span>数字人形象</span>
          <span>文案提取</span>
          <span>AI 改写</span>
          <span>口播预览</span>
        </div>
      </div>

      <div class="landing__stage" aria-label="产品能力预览">
        <div class="landing__orb landing__orb--one" />
        <div class="landing__orb landing__orb--two" />
        <n-card class="landing__console" :bordered="false">
          <div class="console__top">
            <span />
            <span />
            <span />
          </div>
          <div class="console__screen">
            <div class="avatar-preview">
              <div class="avatar-preview__face" />
              <div class="avatar-preview__glow" />
            </div>
            <div class="console__meta">
              <n-text strong>AI 数字人口播任务</n-text>
              <n-text depth="3">职业形象：程序员版</n-text>
              <n-text depth="3">视频比例：<span class="landing__number">9:16</span></n-text>
              <div class="console__progress">
                <span />
              </div>
            </div>
          </div>
          <div class="console__chips">
            <span v-for="p in personas.slice(0, 4)" :key="p">{{ p }}</span>
          </div>
        </n-card>
      </div>
    </section>

    <section class="landing__section">
      <div class="landing__section-head">
        <n-text depth="3">核心能力</n-text>
        <h2>为口播视频生产设计的 AI 工具链</h2>
      </div>
      <div class="landing__grid">
        <n-card v-for="f in features" :key="f.title" class="landing__feature" :bordered="false">
          <h3>{{ f.title }}</h3>
          <p>{{ f.desc }}</p>
        </n-card>
      </div>
    </section>

    <section class="landing__split">
      <div>
        <n-text depth="3">职业形象库</n-text>
        <h2>从泛风格到行业形象，直接选择适合你的角色</h2>
        <p>
          除西装、古风、休闲、道士、时尚等基础风格外，已补充律师、程序员、财务、厨师等职业形象，方便账号矩阵按行业快速开工。
        </p>
      </div>
      <div class="persona-cloud">
        <span v-for="p in personas" :key="p">{{ p }}</span>
      </div>
    </section>

    <section class="landing__section">
      <div class="landing__section-head">
        <n-text depth="3">四步流程</n-text>
        <h2>从素材到预览，路径足够短</h2>
      </div>
      <div class="workflow">
        <div v-for="(item, i) in workflow" :key="item" class="workflow__item">
          <span>{{ String(i + 1).padStart(2, '0') }}</span>
          <strong>{{ item }}</strong>
        </div>
      </div>
    </section>

    <section class="landing__final">
      <h2>准备好让你的口播生产更像一台 AI 工作台了吗？</h2>
      <p>先创建专属数字人，再进入口播制作，快速跑通第一条视频。</p>
      <RouterLink :to="primaryTo">
        <n-button type="primary" size="large" class="landing__cta">立即开始</n-button>
      </RouterLink>
    </section>
  </div>
</template>

<style scoped>
.landing {
  position: relative;
  overflow: hidden;
  padding: 72px 24px 88px;
  color: #f8fafc;
  font-family: Inter, 'PingFang SC', 'Microsoft YaHei', system-ui, -apple-system, BlinkMacSystemFont,
    'Segoe UI', sans-serif;
  background:
    radial-gradient(circle at 18% 8%, rgba(168, 85, 247, 0.35), transparent 30%),
    radial-gradient(circle at 80% 0%, rgba(56, 189, 248, 0.22), transparent 28%),
    radial-gradient(circle at 72% 62%, rgba(236, 72, 153, 0.18), transparent 26%),
    linear-gradient(135deg, #05030d 0%, #090016 45%, #020617 100%);
}

.landing::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background-image:
    linear-gradient(rgba(148, 163, 184, 0.06) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.06) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.85), transparent 82%);
}

.landing__hero,
.landing__section,
.landing__split,
.landing__final {
  position: relative;
  z-index: 1;
  max-width: 1180px;
  margin: 0 auto;
}

.landing__hero {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(360px, 0.95fr);
  gap: 44px;
  align-items: center;
  min-height: 560px;
}

.landing__eyebrow {
  color: #e9d5ff;
  background: rgba(168, 85, 247, 0.18);
  box-shadow: 0 0 24px rgba(168, 85, 247, 0.25);
}

.landing h1,
.landing h2,
.landing h3,
.landing p {
  margin: 0;
}

.landing h1,
.landing h2,
.landing h3 {
  font-family: Sora, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
}

.landing h1 {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  height: 256px;
  margin-top: 50px;
  max-width: 820px;
  padding-top: 10px;
  padding-bottom: 10px;
  font-size: clamp(42px, 7vw, 78px);
  line-height: 85px;
  letter-spacing: 2px;
  text-align: left;
}

.landing__lead {
  max-width: 680px;
  margin-top: 10px;
  color: #cbd5e1;
  font-size: 18px;
  line-height: 1.8;
}

.landing__actions,
.landing__proof {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 28px;
}

.landing__cta {
  border: 0;
  background: linear-gradient(135deg, #ec4899, #8b5cf6 52%, #38bdf8);
  box-shadow: 0 0 32px rgba(236, 72, 153, 0.42);
}

.landing__proof {
  gap: 10px;
  color: #a5b4fc;
  font-size: 13px;
}

.landing__number {
  font-family: Rajdhani, Inter, 'PingFang SC', sans-serif;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.landing__proof span {
  padding: 7px 11px;
  border: 1px solid rgba(129, 140, 248, 0.24);
  border-radius: 999px;
  background: rgba(15, 23, 42, 0.52);
}

.landing__stage {
  position: relative;
  min-height: 440px;
}

.landing__orb {
  position: absolute;
  border-radius: 999px;
  filter: blur(4px);
}

.landing__orb--one {
  top: 30px;
  right: 70px;
  width: 170px;
  height: 170px;
  background: rgba(59, 130, 246, 0.28);
}

.landing__orb--two {
  right: 0;
  bottom: 42px;
  width: 230px;
  height: 230px;
  background: rgba(236, 72, 153, 0.2);
}

.landing__console {
  position: relative;
  margin-top: 34px;
  border: 1px solid rgba(216, 180, 254, 0.22);
  border-radius: 30px;
  background: linear-gradient(145deg, rgba(15, 23, 42, 0.78), rgba(30, 12, 55, 0.66));
  box-shadow:
    0 30px 90px rgba(0, 0, 0, 0.55),
    0 0 70px rgba(124, 58, 237, 0.28);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.console__top {
  display: flex;
  gap: 8px;
  margin-bottom: 22px;
}

.console__top span {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #fb7185;
}

.console__top span:nth-child(2) {
  background: #fbbf24;
}

.console__top span:nth-child(3) {
  background: #22c55e;
}

.console__screen {
  display: grid;
  grid-template-columns: 190px 1fr;
  gap: 22px;
  align-items: center;
}

.avatar-preview {
  position: relative;
  display: grid;
  place-items: center;
  height: 250px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 24px;
  background:
    radial-gradient(circle at 50% 30%, rgba(56, 189, 248, 0.32), transparent 36%),
    linear-gradient(180deg, rgba(30, 41, 59, 0.86), rgba(15, 23, 42, 0.95));
}

.avatar-preview__face {
  position: relative;
  z-index: 2;
  width: 92px;
  height: 132px;
  border-radius: 44px 44px 30px 30px;
  background: linear-gradient(180deg, #e0f2fe, #818cf8 58%, #312e81);
  box-shadow: 0 0 42px rgba(125, 211, 252, 0.42);
}

.avatar-preview__glow {
  position: absolute;
  bottom: -28px;
  width: 160px;
  height: 96px;
  border-radius: 50%;
  background: rgba(236, 72, 153, 0.34);
  filter: blur(18px);
}

.console__meta {
  display: grid;
  gap: 10px;
}

.console__progress {
  width: 100%;
  height: 10px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.18);
}

.console__progress span {
  display: block;
  width: 72%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #ec4899, #8b5cf6, #38bdf8);
}

.console__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
}

.console__chips span,
.persona-cloud span {
  padding: 8px 12px;
  border: 1px solid rgba(216, 180, 254, 0.2);
  border-radius: 999px;
  color: #ddd6fe;
  background: rgba(15, 23, 42, 0.52);
}

.landing__section,
.landing__split,
.landing__final {
  margin-top: 88px;
}

.landing__section-head {
  max-width: 760px;
  margin-bottom: 24px;
}

.landing h2 {
  margin-top: 8px;
  font-size: clamp(28px, 4vw, 44px);
  line-height: 1.12;
  letter-spacing: -0.04em;
}

.landing__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 18px;
}

.landing__feature {
  min-height: 190px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 24px;
  background: rgba(15, 23, 42, 0.58);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
}

.landing__feature h3 {
  font-size: 28px;
}

.landing__feature p,
.landing__split p,
.landing__final p {
  margin-top: 12px;
  color: #cbd5e1;
  line-height: 1.75;
}

.landing__feature p {
  font-size: 15px;
}

.landing__split {
  display: grid;
  grid-template-columns: 0.9fr 1.1fr;
  gap: 32px;
  align-items: center;
  padding: 34px;
  border: 1px solid rgba(216, 180, 254, 0.2);
  border-radius: 30px;
  background:
    radial-gradient(circle at 90% 0%, rgba(236, 72, 153, 0.16), transparent 36%),
    rgba(15, 23, 42, 0.48);
}

.persona-cloud {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 12px;
}

.persona-cloud span {
  font-size: 15px;
}

.workflow {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}

.workflow__item {
  min-height: 128px;
  padding: 20px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 22px;
  background: linear-gradient(145deg, rgba(30, 41, 59, 0.62), rgba(88, 28, 135, 0.22));
}

.workflow__item span {
  display: block;
  margin-bottom: 30px;
  color: #f0abfc;
  font-family: Rajdhani, Inter, 'PingFang SC', sans-serif;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.workflow__item strong {
  font-size: 18px;
}

.landing__final {
  padding: 46px 28px;
  border: 1px solid rgba(236, 72, 153, 0.25);
  border-radius: 34px;
  text-align: center;
  background:
    radial-gradient(circle at 50% 0%, rgba(236, 72, 153, 0.2), transparent 48%),
    rgba(15, 23, 42, 0.62);
}

.landing__final .landing__cta {
  margin-top: 24px;
}

@media (max-width: 980px) {
  .landing {
    padding-top: 44px;
  }

  .landing__hero,
  .landing__split {
    grid-template-columns: 1fr;
  }

  .landing__hero {
    min-height: auto;
  }

  .persona-cloud {
    justify-content: flex-start;
  }

  .landing__grid,
  .workflow {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .landing {
    padding: 34px 14px 56px;
  }

  .landing__actions :deep(.n-button) {
    width: 100%;
  }

  .landing__actions a {
    width: 100%;
  }

  .landing__stage {
    min-height: auto;
  }

  .console__screen,
  .landing__grid,
  .workflow {
    grid-template-columns: 1fr;
  }

  .landing__split {
    padding: 22px;
  }
}
</style>
