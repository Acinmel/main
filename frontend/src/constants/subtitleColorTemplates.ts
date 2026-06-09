export interface SubtitleColorTemplate {
  id: string;
  name: string;
  normalColor: string;
  highlightColor: string;
  strokeColor: string;
  shadowColor: string;
  scene: string;
  aliases?: string[];
}

export interface ResolvedSubtitleTemplateStyle {
  normalColor: string;
  highlightColor: string;
  strokeColor: string;
  shadowColor: string;
  highlightFontSizeScale: number;
  highlightFontWeight: number;
}

export const defaultSubtitleStyle = {
  fontSize: 46,
  highlightFontSizeScale: 1.18,
  fontWeight: 700,
  highlightFontWeight: 900,
  strokeWidth: 3,
  lineHeight: 1.35,
  letterSpacing: 0.3,
  position: "bottom-center",
} as const;

export const subtitleColorTemplates: SubtitleColorTemplate[] = [
  {
    id: "classic_yellow",
    aliases: ["rec-subtitle-a-classic-white-yellow"],
    name: "经典白黄",
    normalColor: "#FFFFFF",
    highlightColor: "#FFD400",
    strokeColor: "#000000",
    shadowColor: "rgba(0,0,0,0.75)",
    scene: "通用口播 / 知识分享",
  },
  {
    id: "tech_green",
    aliases: ["rec-subtitle-b-white-green-tech"],
    name: "AI 荧光绿",
    normalColor: "#FFFFFF",
    highlightColor: "#00FF66",
    strokeColor: "#000000",
    shadowColor: "rgba(0,255,102,0.45)",
    scene: "AI / 科技 / 工具类",
  },
  {
    id: "impact_red",
    aliases: ["rec-subtitle-c-white-red-impact"],
    name: "爆点红",
    normalColor: "#FFFFFF",
    highlightColor: "#FF3B30",
    strokeColor: "#000000",
    shadowColor: "rgba(255,59,48,0.45)",
    scene: "爆点 / 警示 / 强情绪",
  },
  {
    id: "light_black_yellow",
    aliases: ["rec-subtitle-d-black-yellow-alert"],
    name: "浅底黑黄",
    normalColor: "#111111",
    highlightColor: "#FFCC00",
    strokeColor: "#FFFFFF",
    shadowColor: "rgba(0,0,0,0.35)",
    scene: "浅色背景 / 采访 / 室内",
  },
  {
    id: "business_blue",
    aliases: ["rec-subtitle-e-white-blue-pro"],
    name: "商务蓝",
    normalColor: "#FFFFFF",
    highlightColor: "#2F80ED",
    strokeColor: "#000000",
    shadowColor: "rgba(47,128,237,0.45)",
    scene: "商业 / 财经 / SaaS",
  },
  {
    id: "ecommerce_orange",
    aliases: ["rec-subtitle-f-white-orange-commerce"],
    name: "带货橙",
    normalColor: "#FFFFFF",
    highlightColor: "#FF7A00",
    strokeColor: "#000000",
    shadowColor: "rgba(255,122,0,0.45)",
    scene: "电商 / 带货 / 种草",
  },
  {
    id: "premium_gold",
    aliases: ["rec-subtitle-g-ivory-gold-brand"],
    name: "高级金",
    normalColor: "#FFF7E6",
    highlightColor: "#F5C542",
    strokeColor: "#1A1A1A",
    shadowColor: "rgba(0,0,0,0.65)",
    scene: "品牌 / 文旅 / 高级感",
  },
  {
    id: "trend_purple",
    aliases: ["rec-subtitle-h-white-purple-trend"],
    name: "潮流紫",
    normalColor: "#FFFFFF",
    highlightColor: "#A855F7",
    strokeColor: "#000000",
    shadowColor: "rgba(168,85,247,0.45)",
    scene: "AI / 创作者 / 潮流内容",
  },
  {
    id: "cyan_clean",
    aliases: ["rec-subtitle-i-cyan-white-fresh"],
    name: "清爽青",
    normalColor: "#EFFFFF",
    highlightColor: "#00D5FF",
    strokeColor: "#003344",
    shadowColor: "rgba(0,213,255,0.35)",
    scene: "教程 / 工具测评 / 轻科技",
  },
  {
    id: "xiaohongshu_pink",
    aliases: ["rec-subtitle-j-white-pink-lifestyle"],
    name: "小红书粉",
    normalColor: "#FFFFFF",
    highlightColor: "#FF4FA3",
    strokeColor: "#2A0A18",
    shadowColor: "rgba(255,79,163,0.4)",
    scene: "小红书 / 女性向 / 生活方式",
  },
];

const templateAliasMap = new Map<string, SubtitleColorTemplate>();
for (const template of subtitleColorTemplates) {
  templateAliasMap.set(template.id, template);
  for (const alias of template.aliases ?? []) {
    templateAliasMap.set(alias, template);
  }
}

function asColor(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function resolveSubtitleTemplateStyle(
  templateId: string,
  styleJson?: Record<string, unknown> | null,
): ResolvedSubtitleTemplateStyle {
  const matched = templateAliasMap.get(templateId);
  const fallback = matched ?? subtitleColorTemplates[0];
  const normalColor = asColor(styleJson?.color, fallback.normalColor);
  const highlightColor = asColor(
    styleJson?.highlightColor,
    fallback.highlightColor,
  );
  const strokeColor = asColor(styleJson?.stroke, fallback.strokeColor);
  const shadowColor = asColor(styleJson?.shadowColor, fallback.shadowColor);
  const highlightFontWeight =
    typeof styleJson?.highlightFontWeight === "number"
      ? styleJson.highlightFontWeight
      : defaultSubtitleStyle.highlightFontWeight;
  const highlightFontSizeScale =
    typeof styleJson?.highlightFontSizeScale === "number"
      ? styleJson.highlightFontSizeScale
      : defaultSubtitleStyle.highlightFontSizeScale;

  return {
    normalColor,
    highlightColor,
    strokeColor,
    shadowColor,
    highlightFontWeight,
    highlightFontSizeScale,
  };
}
