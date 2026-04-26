import { BadRequestException } from '@nestjs/common';

/**
 * 数字人风格：每项 `content` 作为调用大模型 / 生图接口时的主提示（可直接放入请求的 content 字段）。
 * id 保持稳定供前后端与外部 API 约定。
 */
export type DigitalHumanStyleDef = {
  id: string;
  label: string;
  /** 上传至模型 API 的完整 content */
  content: string;
};

export const DIGITAL_HUMAN_STYLES: readonly DigitalHumanStyleDef[] = [
  {
    id: 'suit',
    label: '西装版',
    content:
      '【任务】根据用户上传的正面人物自拍，生成一张可用于短视频口播的数字人半身形象图，上半身出镜，从腰部以上露出。。【风格要求】商务正装：深色或浅灰西装、衬衫、领带或领结可选，合身剪裁；正脸或微侧脸，目光自然看向镜头；影棚级柔和布光、浅色无杂物背景；写实、高清、肤质自然；无文字水印、无变形手指，单人出镜。',
  },
  {
    id: 'ancient',
    label: '古风版',
    content:
      '【任务】根据用户上传的正面人物自拍，生成一张可用于短视频口播的古风数字人半身形象，上半身出镜，从腰部以上露出。【风格要求】汉服或魏晋风格服饰，束发或发髻配饰简洁；背景留白或淡墨山水意境；柔光、轻微逆光仙气感；人物神态端庄或温和微笑；写实偏插画质感均可；无现代服饰、无文字水印，单人出镜。',
  },
  {
    id: 'casual',
    label: '休闲版',
    content:
      '【任务】根据用户上传的正面人物自拍，生成一张可用于短视频口播的数字人半身形象，上半身出镜，从腰部以上露出。。【风格要求】休闲生活风：卫衣、针织衫或简洁 T 恤等日常穿搭；自然窗光或户外柔和散射光；背景为居家客厅、书房或虚化的街景一角；表情轻松亲切；写实高清；无文字水印，单人出镜。',
  },
  {
    id: 'taoist',
    label: '道士版',
    content:
      '【任务】根据用户上传的正面人物自拍，生成一张可用于短视频口播的道家风格数字人半身形象，上半身出镜，从腰部以上露出。【风格要求】传统道袍、三清领或交领，配色青、灰、白为宜；可配简单道冠或束发；背景可为道观庭院虚化或云雾留白；神态清和、仙风道骨气质；写实；无不当宗教符号堆砌、无文字水印，单人出镜。',
  },
  {
    id: 'fashion',
    label: '时尚版',
    content:
      '【任务】根据用户上传的正面人物自拍，生成一张可用于短视频口播的时尚数字人半身形象，上半身出镜，从腰部以上露出。【风格要求】杂志棚拍风：潮牌或设计师款剪裁、层次叠穿、配饰克制；高调光比或轮廓光；纯色或渐变极简背景；表情自信、略偏秀场定妆照气质；写实时尚摄影质感；无文字水印，单人出镜。',
  },
] as const;

const byId = new Map(DIGITAL_HUMAN_STYLES.map((s) => [s.id, s]));

export function getDigitalHumanStyleOrThrow(styleId: string): DigitalHumanStyleDef {
  const s = byId.get(styleId.trim());
  if (!s) {
    throw new BadRequestException(
      `未知风格：${styleId}。可选：${DIGITAL_HUMAN_STYLES.map((x) => x.id).join('、')}`,
    );
  }
  return s;
}

export function listDigitalHumanStylesPublic(): { id: string; label: string }[] {
  return DIGITAL_HUMAN_STYLES.map((s) => ({ id: s.id, label: s.label }));
}
