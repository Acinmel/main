export interface SubtitleColorTemplate {
  id: string;
  name: string;
  normalColor: string;
  highlightColor: string;
  strokeColor: string;
  shadowColor: string;
  scene: string;
}

export const subtitleColorTemplates: SubtitleColorTemplate[] = [
  {
    id: 'classic_yellow',
    name: '经典白黄',
    normalColor: '#FFFFFF',
    highlightColor: '#FFD400',
    strokeColor: '#000000',
    shadowColor: 'rgba(0,0,0,0.75)',
    scene: '通用口播 / 知识分享',
  },
  {
    id: 'tech_green',
    name: 'AI 荧光绿',
    normalColor: '#FFFFFF',
    highlightColor: '#00FF66',
    strokeColor: '#000000',
    shadowColor: 'rgba(0,255,102,0.45)',
    scene: 'AI / 科技 / 工具类',
  },
  {
    id: 'impact_red',
    name: '爆点红',
    normalColor: '#FFFFFF',
    highlightColor: '#FF3B30',
    strokeColor: '#000000',
    shadowColor: 'rgba(255,59,48,0.45)',
    scene: '爆点 / 警示 / 强情绪',
  },
  {
    id: 'light_black_yellow',
    name: '浅底黑黄',
    normalColor: '#111111',
    highlightColor: '#FFCC00',
    strokeColor: '#FFFFFF',
    shadowColor: 'rgba(0,0,0,0.35)',
    scene: '浅色背景 / 采访 / 室内',
  },
  {
    id: 'business_blue',
    name: '商务蓝',
    normalColor: '#FFFFFF',
    highlightColor: '#2F80ED',
    strokeColor: '#000000',
    shadowColor: 'rgba(47,128,237,0.45)',
    scene: '商业 / 财经 / SaaS',
  },
  {
    id: 'ecommerce_orange',
    name: '带货橙',
    normalColor: '#FFFFFF',
    highlightColor: '#FF7A00',
    strokeColor: '#000000',
    shadowColor: 'rgba(255,122,0,0.45)',
    scene: '电商 / 带货 / 种草',
  },
  {
    id: 'premium_gold',
    name: '高级金',
    normalColor: '#FFF7E6',
    highlightColor: '#F5C542',
    strokeColor: '#1A1A1A',
    shadowColor: 'rgba(0,0,0,0.65)',
    scene: '品牌 / 文旅 / 高级感',
  },
  {
    id: 'trend_purple',
    name: '潮流紫',
    normalColor: '#FFFFFF',
    highlightColor: '#A855F7',
    strokeColor: '#000000',
    shadowColor: 'rgba(168,85,247,0.45)',
    scene: 'AI / 创作者 / 潮流内容',
  },
  {
    id: 'cyan_clean',
    name: '清爽青',
    normalColor: '#EFFFFF',
    highlightColor: '#00D5FF',
    strokeColor: '#003344',
    shadowColor: 'rgba(0,213,255,0.35)',
    scene: '教程 / 工具测评 / 轻科技',
  },
  {
    id: 'xiaohongshu_pink',
    name: '小红书粉',
    normalColor: '#FFFFFF',
    highlightColor: '#FF4FA3',
    strokeColor: '#2A0A18',
    shadowColor: 'rgba(255,79,163,0.4)',
    scene: '小红书 / 女性向 / 生活方式',
  },
];

const subtitleTemplateAliasToResourceId: Record<string, string> = {
  classic_yellow: 'rec-subtitle-a-classic-white-yellow',
  tech_green: 'rec-subtitle-b-white-green-tech',
  impact_red: 'rec-subtitle-c-white-red-impact',
  light_black_yellow: 'rec-subtitle-d-black-yellow-alert',
  business_blue: 'rec-subtitle-e-white-blue-pro',
  ecommerce_orange: 'rec-subtitle-f-white-orange-commerce',
  premium_gold: 'rec-subtitle-g-ivory-gold-brand',
  trend_purple: 'rec-subtitle-h-white-purple-trend',
  cyan_clean: 'rec-subtitle-i-cyan-white-fresh',
  xiaohongshu_pink: 'rec-subtitle-j-white-pink-lifestyle',
};

export function normalizeSubtitleTemplateId(value: string): string {
  const key = value.trim();
  if (!key) return key;
  return subtitleTemplateAliasToResourceId[key] ?? key;
}

export interface DefaultSubtitleStyleProfile {
  fontSize: number;
  highlightFontSizeScale: number;
  fontWeight: number;
  highlightFontWeight: number;
  strokeWidth: number;
  lineHeight: number;
  letterSpacing: number;
  position: 'bottom-center';
}

export const defaultSubtitleStyle: DefaultSubtitleStyleProfile = {
  fontSize: 46,
  highlightFontSizeScale: 1.18,
  fontWeight: 700,
  highlightFontWeight: 900,
  strokeWidth: 3,
  lineHeight: 1.35,
  letterSpacing: 1,
  position: 'bottom-center',
};
