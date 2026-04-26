import type { GlobalThemeOverrides } from 'naive-ui'

/**
 * 顶部提示（Message）：更大占位、更易读、轻拟物层次。
 */
export const appThemeOverrides: GlobalThemeOverrides = {
  Message: {
    margin: '0 0 16px 0',
    padding: '20px 32px',
    minWidth: 'min(96vw, 580px)',
    maxWidth: 'min(96vw, 800px)',
    fontSize: '17px',
    lineHeight: '1.7',
    borderRadius: '18px',
    iconSize: '26px',
    iconMargin: '0 16px 0 0',
    closeSize: '24px',
    closeIconSize: '18px',
    closeMargin: '0 0 0 16px',
    border: '1px solid rgba(148, 163, 184, 0.28)',
    boxShadow:
      '0 24px 56px rgba(0, 0, 0, 0.58), 0 0 0 1px rgba(255, 255, 255, 0.07), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
    boxShadowInfo:
      '0 24px 56px rgba(14, 165, 233, 0.32), 0 0 0 1px rgba(56, 189, 248, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
    boxShadowSuccess:
      '0 24px 56px rgba(34, 197, 94, 0.3), 0 0 0 1px rgba(74, 222, 128, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
    boxShadowWarning:
      '0 24px 56px rgba(234, 179, 8, 0.28), 0 0 0 1px rgba(250, 204, 21, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
    boxShadowError:
      '0 24px 56px rgba(239, 68, 68, 0.32), 0 0 0 1px rgba(248, 113, 113, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
    boxShadowLoading:
      '0 24px 56px rgba(0, 0, 0, 0.52), 0 0 0 1px rgba(148, 163, 184, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.06)',
  },
  Alert: {
    padding: '22px 26px',
    fontSize: '16px',
    lineHeight: '1.75',
    borderRadius: '16px',
    iconSize: '24px',
    iconMargin: '0 16px 0 0',
    titleFontWeight: '600',
  },
}
