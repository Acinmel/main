export type OralScriptStrategy = {
  id: string;
  label: string;
  temperature: number;
  systemHints: string[];
  mockHook3Lead: string;
  mockHook10Lead: string;
  mockBodyLead: string;
  mockEnding: string;
};

export const ORAL_SCRIPT_STRATEGIES: OralScriptStrategy[] = [
  {
    id: 'pain-point',
    label: '痛点直击',
    temperature: 0.52,
    systemHints: [
      '开头优先点出用户最容易卡住的痛点，别先铺背景。',
      '正文按“问题 -> 原因 -> 解法”推进，节奏干脆。',
      '结尾给出立即可执行的一步动作。',
    ],
    mockHook3Lead: '如果你也卡在这件事上，先别划走，',
    mockHook10Lead: '接下来 10 秒，我直接把最容易踩坑的地方讲明白。',
    mockBodyLead: '先把问题讲透，再给出最省时间的处理方式：',
    mockEnding: '照这个顺序讲下去，观众更容易听懂，也更容易继续往下看。',
  },
  {
    id: 'contrast',
    label: '反差悬念',
    temperature: 0.66,
    systemHints: [
      '用“很多人以为...其实...”制造认知反差。',
      '前 10 秒要先破除误区，再抛出正确理解。',
      '整体语气要有一点悬念，但别夸张失真。',
    ],
    mockHook3Lead: '很多人一上来就想错了，其实真正关键的是，',
    mockHook10Lead: '你再听 10 秒，我把大家最常见的误判和正确做法一次说透。',
    mockBodyLead: '别急着照旧方法做，先把认知扭过来：',
    mockEnding: '把这层反差讲清楚，视频开头的留存会比平铺直叙更高。',
  },
  {
    id: 'result-first',
    label: '结果先行',
    temperature: 0.48,
    systemHints: [
      '先讲结果，再倒推原因和过程。',
      '文案语气像在给出一个明确结论，减少铺垫。',
      '适合把“做到什么结果”说得更明确。',
    ],
    mockHook3Lead: '先说结论，照这个思路做，',
    mockHook10Lead: '接下来 10 秒，我把结果为什么能出来，以及你该怎么照着做讲清楚。',
    mockBodyLead: '我们先锁定结果，再倒推关键动作：',
    mockEnding: '先亮结果再拆过程，会更适合短视频用户的阅读习惯。',
  },
  {
    id: 'listicle',
    label: '清单拆解',
    temperature: 0.58,
    systemHints: [
      '改成“第一、第二、第三”这种清单感更强的表达。',
      '每个要点要短，适合用户快速扫描和记忆。',
      '整体像一份可直接照着执行的口播提纲。',
    ],
    mockHook3Lead: '这件事别乱讲，我给你直接拆成 3 个重点，',
    mockHook10Lead: '你继续听 10 秒，我把最该先讲的顺序给你排好。',
    mockBodyLead: '按清单来讲，整段内容会更顺：',
    mockEnding: '清单化表达特别适合数字人口播，节奏会更利落。',
  },
  {
    id: 'case-review',
    label: '案例复盘',
    temperature: 0.62,
    systemHints: [
      '把内容整理成“案例发生了什么 -> 学到了什么 -> 可以怎么用”。',
      '口吻像在做一次简洁复盘，既有信息量也有代入感。',
      '避免空泛总结，要尽量落回真实场景。',
    ],
    mockHook3Lead: '我拿一个真实场景给你复盘一下，',
    mockHook10Lead: '再听 10 秒，我把这个案例里最值得拿走的经验直接提炼给你。',
    mockBodyLead: '这段内容最适合这样复盘出来：',
    mockEnding: '复盘式讲法更容易让用户觉得“这是我也能拿去用的经验”。',
  },
  {
    id: 'misconception-fix',
    label: '错误纠偏',
    temperature: 0.55,
    systemHints: [
      '先指出常见错误，再给正确做法。',
      '让观众感受到“原来我之前一直理解偏了”。',
      '每段表达尽量短促，像在纠正一个错误动作。',
    ],
    mockHook3Lead: '很多人不是不会做，而是一开始就做偏了，',
    mockHook10Lead: '你再听 10 秒，我把最值得立刻纠正的地方讲明白。',
    mockBodyLead: '先把误区掰正，后面的内容才会更顺：',
    mockEnding: '先纠偏再展开，能更快建立这条视频的价值感。',
  },
  {
    id: 'scene-immersive',
    label: '场景代入',
    temperature: 0.68,
    systemHints: [
      '把用户放进一个具体场景里，让画面感更强。',
      '钩子像是在描述“你现在就遇到了这个情况”。',
      '正文要围绕场景推进，不要发散。',
    ],
    mockHook3Lead: '想象一下，你现在正遇到这个场景，',
    mockHook10Lead: '接下来 10 秒，我把这个场景里最该怎么说、怎么做直接排给你。',
    mockBodyLead: '从场景切进去，这段文案会更有代入感：',
    mockEnding: '有场景的口播更容易让用户把内容和自己对上号。',
  },
  {
    id: 'emotion-resonance',
    label: '情绪共鸣',
    temperature: 0.7,
    systemHints: [
      '允许带一点情绪张力，但不能脱离原文信息。',
      '优先把“用户为什么会在意”说出来。',
      '结尾要给人一种被理解、被接住的感觉。',
    ],
    mockHook3Lead: '如果你最近也被这件事反复消耗，先听我一句，',
    mockHook10Lead: '再给我 10 秒，我把最容易共鸣、也最能打动人的那层意思讲出来。',
    mockBodyLead: '先把情绪接住，再把方法讲透：',
    mockEnding: '有共鸣的讲法更容易让视频被看完，也更容易带来互动。',
  },
  {
    id: 'interactive-question',
    label: '提问互动',
    temperature: 0.64,
    systemHints: [
      '开头尽量用提问句，把观众拉进来。',
      '正文中可以保留轻微对话感，但不要口水化。',
      '结尾留一个可自然承接评论互动的问题。',
    ],
    mockHook3Lead: '你有没有发现，真正拉开差距的往往不是努力，而是，',
    mockHook10Lead: '你再听 10 秒，我问你的这个问题，很可能正好卡住了这段内容的重点。',
    mockBodyLead: '用提问带着观众往下听，会更自然：',
    mockEnding: '如果你也遇到过类似情况，后面完全可以顺势接一句互动提问。',
  },
  {
    id: 'solution-direct',
    label: '解决方案',
    temperature: 0.5,
    systemHints: [
      '少铺垫，直接给方法和步骤。',
      '让观众一听就知道“我接下来该怎么做”。',
      '适合把抽象内容落成可执行建议。',
    ],
    mockHook3Lead: '别再绕弯了，解决这件事最快的办法就是，',
    mockHook10Lead: '给我 10 秒，我把最省事、最容易落地的方案直接讲给你。',
    mockBodyLead: '如果目标是马上能做，建议这样整理：',
    mockEnding: '解决方案式的表达最适合拿来直接生成配音和成片。',
  },
];

export function pickRandomOralScriptStrategy(): OralScriptStrategy {
  const index = Math.floor(Math.random() * ORAL_SCRIPT_STRATEGIES.length);
  return ORAL_SCRIPT_STRATEGIES[index] ?? ORAL_SCRIPT_STRATEGIES[0];
}
