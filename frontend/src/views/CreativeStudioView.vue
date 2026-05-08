<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NInput, NProgress, NSpace, NTag, NText } from 'naive-ui'

type CreationStep = {
  no: number
  title: string
}

const steps: CreationStep[] = [
  { no: 1, title: '指定文案' },
  { no: 2, title: '数字人和声音' },
  { no: 3, title: '视频编辑' },
  { no: 4, title: '发布' },
]

const activeStep = ref(1)
const selectedInputMode = ref<'topic' | 'link'>('topic')
const selectedVoiceTab = ref<'material' | 'custom'>('material')
const selectedAvatarTab = ref<'mine' | 'library'>('mine')
const scriptPrompt = ref('')
const outlineText = ref('')
const selectedVoice = ref('高33-已产生声音')
const voiceEmotion = ref('日常')
const voiceSpeed = ref(1.13)
const voicePitch = ref(1)
const audioProgress = ref(96)
const enableSubtitles = ref(true)
const enableCover = ref(false)
const enableMusic = ref(true)
const publishCopy = ref(
  '不敢开播？手把手带你今天复盘！直播间不懂怎么留人，就先从这条短视频开始。'
)
const publishPlatforms = [
  { name: '抖音', icon: '抖', account: '0 个账号' },
  { name: '视频号', icon: '视', account: '0 个账号' },
  { name: '小红书', icon: '红', account: '0 个账号' },
  { name: '快手', icon: '快', account: '0 个账号' },
]

const extractedScripts = [
  '还有为啥那么多人喜欢你？',
  '要人看你的内容很正常吧？！',
  '我跟大家。',
  '我的粉丝人。',
  '千万不要拿到爆款主题！',
  '现在太多新手一上来就照搬：话不分析、音效不换、甚至字幕也直接...',
  '别慌！',
  '你也配了一条卖得不错的视频方案：三天涨粉爆款视频模板。',
  '七天涨出同款创作思路。',
  '15天搭建稳定内容矩阵！',
  '不是骗你。',
  '这才是开始OK！',
]

const progressText = computed(() => `${activeStep.value}/4`)
const progressPercent = computed(() => activeStep.value * 25)

function createOutline() {
  const text = scriptPrompt.value.trim()
  outlineText.value = text
    ? `围绕「${text}」生成大纲：\n1. 开场提出痛点\n2. 拆解用户最关心的问题\n3. 给出可执行步骤\n4. 用结果承诺收尾`
    : '请先输入文案主题或创作方向。'
}

function rewriteOutline() {
  outlineText.value = outlineText.value
    ? `${outlineText.value}\n\n优化建议：压缩口播节奏，增强前 3 秒钩子。`
    : '请先生成或输入大纲内容。'
}

function goPrev() {
  activeStep.value = Math.max(1, activeStep.value - 1)
}

function goNext() {
  activeStep.value = Math.min(4, activeStep.value + 1)
}
</script>

<template>
  <main class="video-create">
    <header class="create-topbar">
      <RouterLink :to="{ name: 'landing' }" class="back-link">‹ 返回首页</RouterLink>
      <ol class="stepper" aria-label="视频创作步骤">
        <li
          v-for="step in steps"
          :key="step.no"
          :class="['stepper__item', { 'stepper__item--active': step.no === activeStep }]"
        >
          <span>{{ step.no }}</span>
          <strong>{{ step.title }}</strong>
        </li>
      </ol>
    </header>

    <Transition name="step-switch" mode="out-in">
    <section v-if="activeStep === 1" key="step-1" class="create-layout">
      <div class="main-board">
        <h1>第一步：指定文案内容</h1>

        <div class="workspace">
          <section class="panel panel--input">
            <div class="mode-tabs">
              <button
                :class="{ active: selectedInputMode === 'topic' }"
                type="button"
                @click="selectedInputMode = 'topic'"
              >
                井喷主题
              </button>
              <button
                :class="{ active: selectedInputMode === 'link' }"
                type="button"
                @click="selectedInputMode = 'link'"
              >
                粘贴链接
              </button>
            </div>

            <div class="prompt-box">
              <n-input
                v-model:value="scriptPrompt"
                placeholder="粘贴/输入主题文案"
                clearable
                class="prompt-input"
              />
              <n-button type="primary" size="small" class="prompt-search">生成脚本</n-button>
            </div>

            <p class="hint">
              根据你提供的主题快速生成口播大纲，也可以粘贴已有文案链接后继续优化。
            </p>

            <div class="input-actions">
              <n-button type="primary" block @click="createOutline">大纲生成成片</n-button>
              <n-button block secondary>自定义拍摄</n-button>
            </div>
          </section>

          <section class="panel panel--outline">
            <div class="panel-head">
              <span>大纲选题</span>
              <n-button text type="primary" size="small">换一批</n-button>
            </div>
            <n-input
              v-model:value="outlineText"
              type="textarea"
              class="outline-editor"
              placeholder="READY TO CREATE"
              :autosize="{ minRows: 18 }"
            />
            <div class="outline-footer">
              <n-text depth="3">READY TO CREATE</n-text>
              <n-space :size="12">
                <n-button type="primary" class="gradient-btn">一键成片</n-button>
                <n-button type="primary" class="blue-btn" @click="rewriteOutline">大纲撰写</n-button>
              </n-space>
            </div>
          </section>
        </div>
      </div>

      <aside class="script-side">
        <div class="script-side__head">
          <div>
            <n-text strong>文案生成结果</n-text>
            <p>提取的文案</p>
          </div>
          <n-space size="small">
            <n-button text type="primary" size="small">手动导入</n-button>
            <n-button text type="primary" size="small">自动提取</n-button>
            <n-tag size="small" :bordered="false">编辑</n-tag>
          </n-space>
        </div>

        <ol class="script-list">
          <li v-for="(line, idx) in extractedScripts" :key="idx">
            <span>{{ idx + 1 }}</span>
            <p>{{ line }}</p>
          </li>
        </ol>
      </aside>
    </section>

    <section v-else-if="activeStep === 2" key="step-2" class="step-two-layout">
      <div class="step-two-head">
        <h1>第二步：数字人对口型</h1>
        <p>配置口播文案、配音参数和出镜数字人，生成可用于成片的视频素材。</p>
      </div>

      <div class="step-two-grid">
        <section class="panel script-panel">
          <div class="section-title">
            <span class="title-icon">T</span>
            <div>
              <strong>口播文案</strong>
              <p>基于第一步生成</p>
            </div>
          </div>
          <ol class="script-lines">
            <li v-for="(line, idx) in extractedScripts.slice(0, 7)" :key="line">
              <span>{{ idx + 1 }}</span>
              <p>{{ line }}</p>
            </li>
          </ol>
        </section>

        <section class="panel voice-panel">
          <div class="section-title section-title--between">
            <div class="section-title__main">
              <span class="title-icon title-icon--sound">◔</span>
              <div>
                <strong>配音设置</strong>
                <p>选择声音并设置语速音调</p>
              </div>
            </div>
            <n-button text type="primary" size="small">+ 声音克隆</n-button>
          </div>

          <div class="soft-tabs">
            <button :class="{ active: selectedVoiceTab === 'material' }" type="button" @click="selectedVoiceTab = 'material'">
              素材库声音
            </button>
            <button :class="{ active: selectedVoiceTab === 'custom' }" type="button" @click="selectedVoiceTab = 'custom'">
              本地声音
            </button>
          </div>

          <div class="voice-form">
            <label>
              <span>选择声音</span>
              <select v-model="selectedVoice">
                <option>高33-已产生声音</option>
                <option>青年女声</option>
                <option>磁性男声</option>
              </select>
            </label>
            <label>
              <span>表现情绪</span>
              <select v-model="voiceEmotion">
                <option>日常</option>
                <option>兴奋</option>
                <option>温柔</option>
              </select>
            </label>
            <label>
              <span>语速</span>
              <input v-model.number="voiceSpeed" type="number" step="0.01" />
            </label>
            <label>
              <span>音调</span>
              <input v-model.number="voicePitch" type="number" step="0.1" />
            </label>
          </div>

          <div class="slider-row">
            <span>语速调节</span>
            <input v-model.number="voiceSpeed" type="range" min="0.5" max="2" step="0.01" />
            <b>{{ voiceSpeed }}</b>
          </div>
          <div class="slider-row">
            <span>音调调节</span>
            <input v-model.number="voicePitch" type="range" min="0.5" max="2" step="0.1" />
            <b>{{ voicePitch }}</b>
          </div>

          <n-button type="primary" block class="voice-generate">生成配音</n-button>

          <div class="audio-card">
            <button type="button">▶</button>
            <div>
              <strong>视频配音已生成</strong>
              <p>声音：{{ selectedVoice }}</p>
            </div>
            <span>00:00 / 01:49</span>
          </div>
          <n-progress type="line" :percentage="audioProgress" :show-indicator="false" />
        </section>

        <section class="panel avatar-panel">
          <div class="section-title section-title--between">
            <div class="section-title__main">
              <span class="title-icon">人</span>
              <div>
                <strong>选择数字人</strong>
                <p>选择出镜形象</p>
              </div>
            </div>
            <n-button text type="primary" size="small">+ 添加数字人</n-button>
          </div>

          <div class="avatar-empty">
            <div class="avatar-empty__icon">♙</div>
            <strong>未选择数字人</strong>
            <p>请选择你的数字人用于生成对口型视频</p>
          </div>

          <div class="soft-tabs soft-tabs--avatar">
            <button :class="{ active: selectedAvatarTab === 'mine' }" type="button" @click="selectedAvatarTab = 'mine'">
              我的数字人
            </button>
            <button :class="{ active: selectedAvatarTab === 'library' }" type="button" @click="selectedAvatarTab = 'library'">
              素材库
            </button>
          </div>

          <n-button block disabled class="render-btn">立即生成对口型视频</n-button>
          <n-button block quaternary type="primary">预览口型</n-button>
        </section>
      </div>
    </section>

    <section v-else-if="activeStep === 3" key="step-3" class="edit-layout">
      <div class="edit-main">
        <h1>第三步：智能剪辑</h1>

        <section class="panel asset-card">
          <div class="section-title">
            <span class="title-icon">1</span>
            <div>
              <strong>智能素材</strong>
              <p>用于自动剪辑的视频素材</p>
            </div>
          </div>
          <div class="material-row">
            <div class="material-thumb">
              <span>封面</span>
            </div>
            <div class="material-meta">
              <strong>视频 2052296589359349760</strong>
              <p>素材已就绪，可用于智能剪辑。</p>
              <p>卡点字幕可在右侧预览确认。</p>
            </div>
            <n-button text type="primary" size="small">更换素材</n-button>
          </div>
        </section>

        <section class="edit-options">
          <label class="switch-row">
            <span>智能卡口</span>
            <input v-model="enableSubtitles" type="checkbox" />
          </label>
          <label class="switch-row">
            <span>封面图</span>
            <input v-model="enableCover" type="checkbox" />
          </label>
          <label class="switch-row">
            <span>智能配乐</span>
            <input v-model="enableMusic" type="checkbox" />
          </label>
          <div class="music-row">
            <span>▶</span>
            <select>
              <option>Chill Flow 2</option>
              <option>Warm Pop</option>
              <option>Light Beat</option>
            </select>
            <input type="range" min="0" max="100" value="50" />
            <b>1.00</b>
          </div>
        </section>
      </div>

      <section class="panel subtitle-panel">
        <div class="section-title section-title--between">
          <div class="section-title__main">
            <span class="title-icon">字</span>
            <div>
              <strong>字幕编辑</strong>
              <p>系统已识别并高亮关键词</p>
            </div>
          </div>
          <n-space size="small">
            <n-tag size="small" :bordered="false">热词</n-tag>
            <n-tag size="small" :bordered="false">口播</n-tag>
            <n-tag size="small" :bordered="false">强调</n-tag>
          </n-space>
        </div>
        <ol class="subtitle-list">
          <li v-for="(line, idx) in extractedScripts.slice(0, 10)" :key="`sub-${idx}`">
            <span>{{ idx + 1 }}</span>
            <p>{{ line }} <mark v-if="idx % 2 === 0">关键词</mark></p>
          </li>
        </ol>
        <n-button type="primary" block class="sync-btn">全部同步</n-button>
      </section>

      <aside class="preview-side">
        <div class="preview-head">
          <n-text strong>主视频预览</n-text>
          <n-space size="small">
            <n-button size="tiny" type="error" ghost>删除视频</n-button>
            <n-button size="tiny" type="primary" ghost>重新编辑</n-button>
            <n-button size="tiny" type="primary">导出</n-button>
          </n-space>
        </div>
        <div class="phone-preview">
          <div class="phone-face">
            <span>视频预览</span>
          </div>
        </div>
      </aside>
    </section>

    <section v-else-if="activeStep === 4" key="step-4" class="publish-layout">
      <div class="publish-left">
        <section class="publish-hero">
          <h1>发布任务就绪</h1>
          <p>预估发布效果 · 选择平台并配置发布计划</p>
          <div class="publish-stats">
            <div><strong>0</strong><span>待发布平台</span></div>
            <div><strong>0</strong><span>已连接账号</span></div>
            <div><strong>0</strong><span>预估触达</span></div>
          </div>
        </section>

        <section class="panel copy-card">
          <div class="section-title section-title--between">
            <div class="section-title__main">
              <span class="title-icon">文</span>
              <div>
                <strong>发布设置</strong>
                <p>完善标题与正文</p>
              </div>
            </div>
            <n-space size="small">
              <n-button text size="small">复制</n-button>
              <n-button text size="small">重写</n-button>
            </n-space>
          </div>
          <n-input
            v-model:value="publishCopy"
            type="textarea"
            :autosize="{ minRows: 5 }"
            class="publish-copy"
          />
          <div class="cover-row">
            <div class="cover-thumb">封面</div>
            <div>
              <strong>视频封面</strong>
              <p>已生成默认封面，可继续替换</p>
            </div>
          </div>
          <n-button block quaternary type="primary">+ 添加更多封面</n-button>
        </section>
      </div>

      <div class="publish-center">
        <section class="panel platform-card">
          <div class="section-title section-title--between">
            <strong>发布平台</strong>
            <n-button text type="primary" size="small">+ 绑定账号</n-button>
          </div>
          <div class="platform-list">
            <div v-for="platform in publishPlatforms" :key="platform.name" class="platform-item">
              <span>{{ platform.icon }}</span>
              <div>
                <strong>{{ platform.name }}</strong>
                <p>{{ platform.account }} · 未选择发布账号</p>
              </div>
              <n-button size="tiny">去绑定</n-button>
            </div>
          </div>
        </section>

        <section class="panel schedule-card">
          <div class="section-title">
            <span class="title-icon">时</span>
            <div>
              <strong>发布计划</strong>
              <p>设置发布时间或保存草稿</p>
            </div>
          </div>
          <div class="schedule-options">
            <button class="active" type="button">立即发布</button>
            <button type="button">定时发布</button>
          </div>
          <n-button block disabled class="publish-btn">立即发布至 0 个平台 / 0 个账号</n-button>
          <div class="plan-empty">暂无发布计划</div>
        </section>
      </div>

      <aside class="preview-side preview-side--publish">
        <div class="preview-head">
          <n-text strong>发布预览</n-text>
          <n-button size="tiny" ghost>重新生成</n-button>
        </div>
        <div class="phone-preview phone-preview--final">
          <div class="phone-face phone-face--poster">
            <strong>不敢开播了</strong>
            <span>手把手带你当天变现</span>
          </div>
        </div>
      </aside>
    </section>

    </Transition>

    <footer class="create-footer">
      <div class="footer-progress">
        <n-text depth="3">创作进度</n-text>
        <strong>{{ progressText }}</strong>
        <n-progress type="line" :percentage="progressPercent" :show-indicator="false" />
      </div>
      <n-space>
        <n-button v-if="activeStep > 1" size="large" quaternary @click="goPrev">上一步</n-button>
        <n-button class="next-btn" size="large" @click="goNext">下一步 ›</n-button>
      </n-space>
    </footer>
  </main>
</template>

<style scoped>
.video-create {
  min-height: 100vh;
  min-height: 100dvh;
  padding-bottom: 76px;
  color: var(--text-main);
  background:
    radial-gradient(circle at 84% 20%, rgba(0, 210, 106, 0.12), transparent 30%),
    radial-gradient(circle at 34% 62%, rgba(22, 242, 139, 0.06), transparent 34%),
    linear-gradient(135deg, #000302 0%, var(--bg-main) 42%, #000000 100%);
}

.create-topbar {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr) 180px;
  align-items: center;
  height: 58px;
  padding: 0 24px;
  border-bottom: 1px solid var(--border-soft);
  background: rgba(2, 6, 5, 0.86);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.18);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.back-link {
  color: var(--text-sub);
  font-size: 13px;
  text-decoration: none;
}

.back-link:hover {
  color: var(--primary);
  text-shadow: 0 0 18px rgba(22, 242, 139, 0.22);
}

.stepper {
  display: flex;
  justify-content: center;
  gap: 36px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.stepper__item {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-light);
  font-size: 12px;
  transition:
    color var(--transition-fast),
    transform var(--transition-smooth);
}

.stepper__item span {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  color: var(--text-sub);
  border-radius: 999px;
  border: 1px solid rgba(22, 242, 139, 0.16);
  background: rgba(22, 242, 139, 0.06);
  transition:
    color var(--transition-fast),
    border-color var(--transition-fast),
    background var(--transition-fast),
    box-shadow var(--transition-fast);
}

.stepper__item--active {
  color: var(--primary);
  transform: translateY(-1px);
}

.stepper__item--active span {
  color: #02110a;
  border-color: rgba(22, 242, 139, 0.42);
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
  box-shadow: 0 0 24px rgba(22, 242, 139, 0.22);
}

.create-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 260px;
  gap: 24px;
  padding: 28px 28px 0;
}

.main-board {
  min-width: 0;
}

.main-board h1 {
  margin: 0 0 26px;
  font-size: 20px;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(320px, 0.95fr) minmax(420px, 1fr);
  gap: 28px;
}

.panel {
  min-height: 468px;
  padding: 20px;
  border: 1px solid var(--border-soft);
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(8, 28, 21, 0.78), rgba(2, 10, 7, 0.86));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    var(--shadow-soft);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-smooth);
}

.panel:hover {
  border-color: var(--border-strong);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 18px 44px rgba(0, 0, 0, 0.38),
    0 0 30px rgba(22, 242, 139, 0.12);
  transform: translateY(-3px);
}

.mode-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 4px;
  margin-bottom: 18px;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.22);
}

.mode-tabs button {
  height: 38px;
  color: var(--text-sub);
  cursor: pointer;
  border: 0;
  border-radius: 12px;
  background: transparent;
}

.mode-tabs button.active {
  color: #02110a;
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
  box-shadow: 0 10px 24px rgba(22, 242, 139, 0.14);
}

.prompt-box {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 98px;
  gap: 10px;
  padding: 10px;
  border: 1px solid rgba(22, 242, 139, 0.18);
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.2);
}

.prompt-input :deep(.n-input) {
  background: rgba(0, 0, 0, 0.2);
}

.prompt-search,
.gradient-btn {
  color: #02110a;
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
  box-shadow: 0 12px 30px rgba(22, 242, 139, 0.14);
}

.hint {
  margin: 10px 0 14px;
  color: var(--text-sub);
  font-size: 12px;
  line-height: 1.7;
}

.input-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.panel--outline {
  display: flex;
  flex-direction: column;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 14px;
  color: var(--primary);
  font-weight: 700;
}

.outline-editor {
  flex: 1;
}

.outline-editor :deep(.n-input),
.outline-editor :deep(.n-input-wrapper) {
  min-height: 100%;
  background: rgba(0, 0, 0, 0.18);
}

.outline-footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-top: 18px;
}

.outline-footer :deep(.n-button) {
  min-width: 178px;
  height: 48px;
  border-radius: 12px;
}

.blue-btn {
  color: #02110a;
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
}

.script-side {
  min-height: calc(100vh - 160px);
  padding: 18px 16px;
  border-left: 1px solid var(--border-soft);
  background: rgba(2, 10, 7, 0.72);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.script-side__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.script-side__head p {
  margin: 6px 0 0;
  color: var(--text-sub);
  font-size: 12px;
}

.script-list {
  display: grid;
  gap: 13px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.script-list li {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 8px;
  color: var(--text-main);
  font-size: 12px;
  line-height: 1.55;
}

.script-list span {
  color: var(--text-light);
}

.script-list p {
  margin: 0;
}

.create-footer {
  position: fixed;
  right: 0;
  bottom: 0;
  left: var(--sidebar-width, 224px);
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  height: 68px;
  padding: 0 28px;
  border-top: 1px solid var(--border-soft);
  background: rgba(2, 6, 5, 0.9);
  box-shadow: 0 -10px 34px rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.footer-progress {
  width: min(240px, 40vw);
}

.footer-progress strong {
  display: block;
  margin: 2px 0 4px;
  color: var(--primary);
  font-size: 12px;
}

.next-btn {
  min-width: 110px;
  color: #02110a;
  border-color: rgba(22, 242, 139, 0.42);
  border-radius: 14px;
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
  box-shadow: 0 10px 26px rgba(22, 242, 139, 0.16);
}

.step-two-layout {
  padding: 28px;
}

.step-two-head {
  margin-bottom: 24px;
}

.step-two-head h1 {
  margin: 0 0 6px;
  font-size: 22px;
}

.step-two-head p {
  margin: 0;
  color: var(--text-sub);
  font-size: 13px;
}

.step-two-grid {
  display: grid;
  grid-template-columns: minmax(260px, 0.92fr) minmax(320px, 0.9fr) minmax(300px, 0.86fr);
  gap: 22px;
  align-items: start;
}

.script-panel,
.voice-panel,
.avatar-panel {
  min-height: 330px;
}

.section-title,
.section-title__main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.section-title {
  margin-bottom: 18px;
}

.section-title--between {
  justify-content: space-between;
}

.section-title strong {
  display: block;
  font-size: 15px;
}

.section-title p {
  margin: 3px 0 0;
  color: var(--text-sub);
  font-size: 11px;
}

.title-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  color: #02110a;
  border-radius: 9px;
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
  box-shadow: 0 0 20px rgba(22, 242, 139, 0.18);
  font-size: 12px;
  font-weight: 800;
}

.title-icon--sound {
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
}

.script-lines {
  display: grid;
  gap: 14px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.script-lines li {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 8px;
  font-size: 12px;
  line-height: 1.6;
}

.script-lines span {
  color: var(--text-light);
}

.script-lines p {
  margin: 0;
}

.soft-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 4px;
  margin-bottom: 16px;
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.22);
}

.soft-tabs button {
  height: 32px;
  color: var(--text-sub);
  cursor: pointer;
  border: 0;
  border-radius: 10px;
  background: transparent;
  font-size: 12px;
}

.soft-tabs button.active {
  color: #02110a;
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
  box-shadow: 0 10px 24px rgba(22, 242, 139, 0.14);
}

.voice-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 14px;
}

.voice-form label,
.slider-row {
  display: grid;
  gap: 7px;
  color: var(--text-sub);
  font-size: 11px;
}

.voice-form select,
.voice-form input {
  width: 100%;
  height: 36px;
  padding: 0 10px;
  color: var(--text-main);
  border: 1px solid rgba(22, 242, 139, 0.18);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.22);
}

.slider-row {
  grid-template-columns: 64px minmax(0, 1fr) 34px;
  align-items: center;
  margin: 10px 0;
}

.slider-row input {
  accent-color: var(--primary);
}

.slider-row b {
  color: var(--primary);
  font-weight: 700;
}

.voice-generate {
  height: 38px;
  margin: 14px 0;
  border-radius: 10px;
  color: #02110a;
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
}

.audio-card {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 12px;
  margin-top: 8px;
  border: 1px solid rgba(22, 242, 139, 0.18);
  border-radius: 14px;
  background: rgba(22, 242, 139, 0.08);
}

.audio-card button {
  width: 28px;
  height: 28px;
  color: #02110a;
  border: 0;
  border-radius: 999px;
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
}

.audio-card strong {
  color: var(--primary);
  font-size: 12px;
}

.audio-card p,
.audio-card span {
  margin: 2px 0 0;
  color: var(--text-sub);
  font-size: 11px;
}

.avatar-empty {
  display: grid;
  place-items: center;
  min-height: 156px;
  margin-bottom: 18px;
  padding: 18px;
  text-align: center;
  border: 1px dashed rgba(22, 242, 139, 0.28);
  border-radius: 22px;
  background: rgba(0, 0, 0, 0.18);
}

.avatar-empty__icon {
  display: grid;
  place-items: center;
  width: 54px;
  height: 54px;
  margin-bottom: 8px;
  color: var(--primary);
  border-radius: 18px;
  background: rgba(22, 242, 139, 0.08);
  box-shadow: 0 0 22px rgba(22, 242, 139, 0.14);
}

.avatar-empty strong {
  font-size: 14px;
}

.avatar-empty p {
  margin: 6px 0 0;
  color: var(--text-sub);
  font-size: 12px;
}

.soft-tabs--avatar {
  margin-top: 10px;
}

.render-btn {
  height: 40px;
  margin: 14px 0 8px;
  border-radius: 12px;
}

.edit-layout,
.publish-layout {
  display: grid;
  gap: 22px;
  padding: 28px;
}

.edit-layout {
  grid-template-columns: minmax(280px, 0.86fr) minmax(360px, 1fr) 236px;
}

.publish-layout {
  grid-template-columns: minmax(320px, 0.95fr) minmax(360px, 0.95fr) 236px;
}

.edit-main h1 {
  margin: 0 0 18px;
  font-size: 22px;
}

.asset-card,
.copy-card,
.platform-card,
.schedule-card {
  min-height: 0;
}

.material-row,
.cover-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) auto;
  gap: 14px;
  align-items: center;
}

.material-thumb,
.cover-thumb {
  display: grid;
  place-items: center;
  width: 68px;
  height: 92px;
  color: #02110a;
  border-radius: 12px;
  background: linear-gradient(145deg, var(--primary), var(--primary-deep));
  box-shadow: 0 0 24px rgba(22, 242, 139, 0.16);
  font-size: 12px;
}

.material-meta p,
.cover-row p {
  margin: 6px 0 0;
  color: var(--text-sub);
  font-size: 12px;
}

.edit-options {
  display: grid;
  gap: 16px;
  margin-top: 24px;
}

.switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text-sub);
  font-size: 13px;
}

.switch-row input {
  width: 38px;
  height: 20px;
  accent-color: var(--primary);
}

.music-row {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) minmax(70px, 0.6fr) 42px;
  gap: 10px;
  align-items: center;
  padding: 10px;
  border: 1px solid rgba(22, 242, 139, 0.16);
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.22);
}

.music-row select {
  height: 34px;
  color: var(--text-main);
  border: 1px solid rgba(22, 242, 139, 0.18);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.22);
}

.subtitle-panel {
  min-height: 520px;
}

.subtitle-list {
  display: grid;
  gap: 12px;
  padding: 0;
  margin: 0 0 22px;
  list-style: none;
}

.subtitle-list li {
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 8px;
  font-size: 13px;
}

.subtitle-list span {
  color: var(--text-light);
}

.subtitle-list p {
  margin: 0;
}

.subtitle-list mark {
  color: #02110a;
  background: rgba(22, 242, 139, 0.72);
  border-radius: 4px;
}

.sync-btn {
  height: 44px;
  border-radius: 12px;
  color: #02110a;
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
}

.preview-side {
  min-height: calc(100vh - 148px);
  padding: 14px 12px;
  border-left: 1px solid var(--border-soft);
  background: rgba(2, 10, 7, 0.72);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.phone-preview {
  display: grid;
  place-items: center;
}

.phone-face {
  display: grid;
  place-items: center;
  width: min(190px, 100%);
  aspect-ratio: 9 / 16;
  color: #ffffff;
  border-radius: 24px;
  background:
    radial-gradient(circle at 50% 20%, rgba(22, 242, 139, 0.18), transparent 26%),
    linear-gradient(180deg, #0b2d20, #020605);
  box-shadow:
    0 18px 42px rgba(0, 0, 0, 0.34),
    0 0 34px rgba(22, 242, 139, 0.12);
}

.publish-left,
.publish-center {
  display: grid;
  gap: 18px;
  align-content: start;
}

.publish-hero {
  padding: 22px;
  color: var(--text-main);
  border: 1px solid var(--border-strong);
  border-radius: 20px;
  background:
    radial-gradient(circle at 90% 0%, rgba(22, 242, 139, 0.22), transparent 32%),
    linear-gradient(135deg, rgba(8, 38, 26, 0.95), rgba(0, 60, 34, 0.86) 54%, rgba(2, 8, 6, 0.96));
  box-shadow: 0 18px 44px rgba(22, 242, 139, 0.12);
}

.publish-hero h1 {
  margin: 0 0 6px;
}

.publish-hero p {
  margin: 0;
  opacity: 0.8;
}

.publish-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 18px;
}

.publish-stats div {
  padding: 12px;
  border: 1px solid rgba(22, 242, 139, 0.16);
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.22);
}

.publish-stats strong,
.publish-stats span {
  display: block;
}

.publish-stats span {
  margin-top: 4px;
  font-size: 11px;
  opacity: 0.72;
}

.publish-copy :deep(.n-input) {
  background: rgba(0, 0, 0, 0.18);
}

.cover-row {
  grid-template-columns: 56px minmax(0, 1fr);
  margin: 14px 0;
}

.cover-thumb {
  width: 52px;
  height: 62px;
}

.platform-list {
  display: grid;
  gap: 12px;
}

.platform-item {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border: 1px solid rgba(22, 242, 139, 0.14);
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.18);
  transition:
    border-color var(--transition-fast),
    background var(--transition-fast),
    transform var(--transition-smooth);
}

.platform-item:hover {
  border-color: var(--border-strong);
  background: rgba(22, 242, 139, 0.08);
  transform: translateX(4px);
}

.platform-item > span {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  color: #02110a;
  border-radius: 10px;
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
  font-size: 12px;
}

.platform-item p {
  margin: 4px 0 0;
  color: var(--text-sub);
  font-size: 11px;
}

.schedule-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-bottom: 14px;
}

.schedule-options button {
  height: 38px;
  color: var(--text-sub);
  cursor: pointer;
  border: 1px solid rgba(22, 242, 139, 0.18);
  border-radius: 12px;
  background: rgba(0, 0, 0, 0.18);
}

.schedule-options button.active {
  color: #02110a;
  background: linear-gradient(135deg, var(--primary), var(--primary-deep));
}

.publish-btn {
  height: 44px;
  margin-bottom: 14px;
  border-radius: 12px;
}

.plan-empty {
  display: grid;
  place-items: center;
  min-height: 88px;
  color: var(--text-sub);
  border-radius: 14px;
  border: 1px dashed rgba(22, 242, 139, 0.18);
  background: rgba(0, 0, 0, 0.18);
  font-size: 13px;
}

.phone-face--poster {
  align-content: end;
  gap: 6px;
  padding: 26px 14px;
  text-align: center;
  background:
    linear-gradient(180deg, transparent 45%, rgba(0, 0, 0, 0.72)),
    radial-gradient(circle at 50% 18%, rgba(22, 242, 139, 0.42), transparent 22%),
    linear-gradient(180deg, #0b2d20, #020605);
}

.phone-face--poster strong {
  color: var(--primary);
  font-size: 19px;
}

.phone-face--poster span {
  font-size: 12px;
}

.step-switch-enter-active,
.step-switch-leave-active {
  transition:
    opacity 0.24s ease,
    transform var(--transition-smooth),
    filter 0.24s ease;
}

.step-switch-enter-from {
  opacity: 0;
  filter: blur(8px);
  transform: translateY(12px) scale(0.992);
}

.step-switch-leave-to {
  opacity: 0;
  filter: blur(6px);
  transform: translateY(-8px) scale(0.992);
}

@media (max-width: 1180px) {
  .create-layout,
  .workspace,
  .step-two-grid,
  .edit-layout,
  .publish-layout {
    grid-template-columns: 1fr;
  }

  .script-side,
  .preview-side {
    min-height: 0;
    border-left: 0;
    border-top: 1px solid var(--border-soft);
  }
}

@media (max-width: 760px) {
  .create-topbar {
    grid-template-columns: 1fr;
    height: auto;
    gap: 12px;
    padding: 14px;
  }

  .stepper {
    justify-content: flex-start;
    gap: 14px;
    overflow-x: auto;
  }

  .create-layout {
    padding: 18px 14px 0;
  }

  .input-actions,
  .prompt-box,
  .outline-footer {
    grid-template-columns: 1fr;
    flex-direction: column;
  }

  .create-footer {
    left: var(--sidebar-width, 92px);
    padding: 0 14px;
  }
}
</style>
