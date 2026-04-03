import type { CSSProperties } from 'react'
import { X } from 'lucide-react'
import type { AiDiagramSceneHint } from './ai/aiDiagram'
import type { AiSceneCapsulePreset } from './ai/aiPromptPresets'
import styles from './editor/flowEditor.module.css'

type Props = {
  presets: AiSceneCapsulePreset[]
  selectedScene: AiDiagramSceneHint | null
  disabled?: boolean
  onSelect: (preset: AiSceneCapsulePreset) => void
  /** 取消高亮、清空场景路由，并清空输入框预填文案 */
  onClearScene: () => void
}

/**
 * 场景胶囊：选中后高亮 + 关闭图标取消选中（类 Toggle Group / Filter chip 交互）
 */
export function AiSceneCapsules({ presets, selectedScene, disabled, onSelect, onClearScene }: Props) {
  return (
    <div className={styles.aiSceneCapsules} role="group" aria-label="生图场景">
      {presets.map((preset) => {
        const active = selectedScene === preset.scene

        return (
          <div
            key={preset.id}
            className={`${styles.aiSceneCapsule} ${active ? styles.aiSceneCapsule_active : ''}`}
            style={
              active
                ? ({
                    '--ai-capsule-accent': preset.accentHex,
                  } as CSSProperties)
                : undefined
            }
          >
            <button
              type="button"
              className={styles.aiSceneCapsuleMain}
              disabled={disabled}
              aria-pressed={active}
              onClick={() => onSelect(preset)}
            >
              <span className={styles.aiSceneCapsuleLabel}>{preset.label}</span>
            </button>
            {active && (
              <button
                type="button"
                className={styles.aiSceneCapsuleClose}
                disabled={disabled}
                aria-label={`取消「${preset.label}」场景`}
                title="取消场景高亮"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onClearScene()
                }}
              >
                <X size={12} strokeWidth={2.25} aria-hidden />
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
