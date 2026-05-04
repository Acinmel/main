<script setup lang="ts">
import { NButton, NTag, NText } from 'naive-ui'
import { RouterLink } from 'vue-router'

type ShowcaseWork = {
  title: string
  desc: string
  image: string
  tag: string
  accent: string
}

function svgPreview(title: string, accent: string, label: string) {
  return `data:image/svg+xml;utf8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 960">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#05030d"/>
          <stop offset="52%" stop-color="#17002f"/>
          <stop offset="100%" stop-color="#020617"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="30%" r="58%">
          <stop offset="0%" stop-color="${accent}" stop-opacity="0.72"/>
          <stop offset="100%" stop-color="${accent}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="720" height="960" fill="url(#bg)"/>
      <rect width="720" height="960" fill="url(#glow)"/>
      <circle cx="360" cy="298" r="118" fill="#e0f2fe" opacity="0.92"/>
      <rect x="230" y="410" width="260" height="330" rx="120" fill="${accent}" opacity="0.82"/>
      <rect x="94" y="74" width="532" height="812" rx="42" fill="none" stroke="rgba(255,255,255,0.22)" stroke-width="2"/>
      <text x="360" y="812" text-anchor="middle" fill="#f8fafc" font-size="42" font-family="Arial, sans-serif" font-weight="700">${title}</text>
      <text x="360" y="860" text-anchor="middle" fill="#cbd5e1" font-size="24" font-family="Arial, sans-serif">${label}</text>
    </svg>
  `)}`
}

const works: ShowcaseWork[] = [
  {
    title: '职场口播',
    desc: '适合知识分享、课程导流和产品介绍的半身数字人口播封面。',
    image: svgPreview('职场口播', '#38bdf8', 'AI Digital Human'),
    tag: '知识分享',
    accent: '#38bdf8',
  },
  {
    title: '时尚种草',
    desc: '偏生活方式与消费品推荐场景，突出人物质感和短视频节奏。',
    image: svgPreview('时尚种草', '#ec4899', 'Lifestyle Preview'),
    tag: '种草带货',
    accent: '#ec4899',
  },
  {
    title: '财经解读',
    desc: '用于财经观点、数据解读、行业分析类内容的稳重风格展示。',
    image: svgPreview('财经解读', '#8b5cf6', 'Finance Talk'),
    tag: '行业解读',
    accent: '#8b5cf6',
  },
  {
    title: '本地生活',
    desc: '面向门店活动、城市探店和服务介绍，强调亲和力与转化。',
    image: svgPreview('本地生活', '#22c55e', 'Local Service'),
    tag: '门店推广',
    accent: '#22c55e',
  },
  {
    title: '法律科普',
    desc: '适合严肃主题的法规讲解、案例分析和专业咨询内容。',
    image: svgPreview('法律科普', '#f59e0b', 'Legal Talk'),
    tag: '专业科普',
    accent: '#f59e0b',
  },
  {
    title: '科技测评',
    desc: '用于数码测评、工具推荐和教程演示，画面更偏科技感。',
    image: svgPreview('科技测评', '#06b6d4', 'Tech Review'),
    tag: '科技内容',
    accent: '#06b6d4',
  },
]
</script>

<template>
  <div class="works-page">
    <section class="works-hero">
      <n-tag :bordered="false" class="works-hero__tag">SHOWCASE GALLERY</n-tag>
      <h1>用户作品展示</h1>
      <p>正式作品流还未接入前，这里先作为静态展示橱窗。当前仅放图片资源，后续可直接替换为真实视频封面图。</p>
      <RouterLink :to="{ name: 'studio' }">
        <n-button type="primary" size="large" class="works-hero__cta">去生成新作品</n-button>
      </RouterLink>
    </section>

    <section class="works-grid" aria-label="作品展示列表">
      <article v-for="work in works" :key="work.title" class="work-card">
        <div class="work-card__image-wrap" :style="{ '--accent': work.accent }">
          <img :src="work.image" :alt="work.title" class="work-card__image" />
        </div>
        <div class="work-card__body">
          <n-tag size="small" round :bordered="false" class="work-card__tag">{{ work.tag }}</n-tag>
          <h2>{{ work.title }}</h2>
          <n-text depth="3">{{ work.desc }}</n-text>
        </div>
      </article>
    </section>
  </div>
</template>

<style scoped>
.works-page {
  position: relative;
  overflow: hidden;
  min-height: 100%;
  padding: 64px 24px 88px;
  color: #f8fafc;
  background:
    radial-gradient(circle at 18% 8%, rgba(168, 85, 247, 0.3), transparent 30%),
    radial-gradient(circle at 82% 8%, rgba(56, 189, 248, 0.2), transparent 28%),
    radial-gradient(circle at 72% 72%, rgba(236, 72, 153, 0.16), transparent 28%);
}

.works-page::before {
  position: absolute;
  inset: 0;
  pointer-events: none;
  content: '';
  background-image:
    linear-gradient(rgba(148, 163, 184, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(148, 163, 184, 0.045) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.82), transparent 84%);
}

.works-hero,
.works-grid {
  position: relative;
  z-index: 1;
  width: min(1280px, 100%);
  margin: 0 auto;
}

.works-hero {
  max-width: 760px;
  text-align: center;
}

.works-hero__tag {
  color: #e9d5ff;
  background: rgba(168, 85, 247, 0.18);
  box-shadow: 0 0 24px rgba(168, 85, 247, 0.25);
}

.works-hero h1 {
  margin: 24px 0 0;
  font-family: Sora, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif;
  font-size: clamp(40px, 6vw, 72px);
  line-height: 1.08;
  letter-spacing: 1px;
}

.works-hero p {
  margin: 18px auto 0;
  color: #cbd5e1;
  font-size: 17px;
  line-height: 1.8;
}

.works-hero__cta {
  margin-top: 28px;
  border: 0;
  background: linear-gradient(135deg, #ec4899, #8b5cf6 52%, #38bdf8);
  box-shadow: 0 0 32px rgba(236, 72, 153, 0.42);
}

.works-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 22px;
  margin-top: 48px;
}

.work-card {
  overflow: hidden;
  border: 1px solid rgba(216, 180, 254, 0.2);
  border-radius: 28px;
  background:
    linear-gradient(145deg, rgba(15, 23, 42, 0.84), rgba(30, 12, 55, 0.68)),
    rgba(15, 23, 42, 0.8);
  box-shadow:
    0 26px 72px rgba(0, 0, 0, 0.38),
    0 0 48px rgba(124, 58, 237, 0.12);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.work-card__image-wrap {
  position: relative;
  padding: 14px;
}

.work-card__image-wrap::before {
  position: absolute;
  inset: 18px;
  content: '';
  background: var(--accent);
  filter: blur(34px);
  opacity: 0.24;
}

.work-card__image {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 20px;
}

.work-card__body {
  padding: 0 18px 20px;
}

.work-card__tag {
  color: #dbeafe;
  background: rgba(56, 189, 248, 0.14);
}

.work-card h2 {
  margin: 12px 0 8px;
  color: #f8fafc;
  font-size: 22px;
}

.work-card :deep(.n-text) {
  font-size: 14px;
  line-height: 1.7;
}

@media (max-width: 900px) {
  .works-page {
    padding: 44px max(16px, var(--app-safe-left, 0px)) 64px max(16px, var(--app-safe-right, 0px));
  }

  .works-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 480px) {
  .works-grid {
    grid-template-columns: 1fr;
    margin-top: 34px;
  }
}
</style>
