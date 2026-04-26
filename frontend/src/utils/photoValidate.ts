/**
 * 客户端照片校验（MVP）：类型、大小、分辨率启发式
 * 最终「单人正脸」等需后端模型二次校验
 */

const ALLOWED_TYPES = ['image/jpeg', 'image/png']
const MAX_BYTES = 8 * 1024 * 1024
const MIN_EDGE = 512

export interface PhotoValidationResult {
  ok: boolean
  message?: string
}

export async function validatePortraitPhoto(file: File): Promise<PhotoValidationResult> {
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, message: '仅支持 JPG / PNG 格式，请重新选择文件。' }
  }
  if (file.size > MAX_BYTES) {
    return { ok: false, message: '图片过大（上限 8MB），请压缩后重新上传。' }
  }

  const dims = await readImageDimensions(file)
  if (!dims) {
    return { ok: false, message: '无法读取图片，请确认文件未损坏。' }
  }
  if (dims.width < MIN_EDGE || dims.height < MIN_EDGE) {
    return {
      ok: false,
      message: `分辨率过低（建议最短边 ≥ ${MIN_EDGE}px），请更换更清晰的照片。`,
    }
  }

  return { ok: true }
}

function readImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    img.src = url
  })
}
