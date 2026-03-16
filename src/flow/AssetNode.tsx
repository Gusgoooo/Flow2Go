import { useCallback, useMemo } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import { type GradientValue, gradientToCss } from './GradientColorEditor'

export type AssetNodeData = {
  assetUrl: string
  assetName?: string
  assetType?: 'svg' | 'png'
  assetWidth?: number
  assetHeight?: number
  colorOverride?: GradientValue
}

const DEFAULT_WIDTH = 120
const DEFAULT_HEIGHT = 80
const MIN_SIZE = 20

export function AssetNode(props: NodeProps) {
  const data = (props.data ?? {}) as AssetNodeData
  const rf = useReactFlow()
  const w = data.assetWidth ?? DEFAULT_WIDTH
  const h = data.assetHeight ?? DEFAULT_HEIGHT
  const selected = (props as any).selected
  const isSvg = data.assetType === 'svg'
  const colorOverride = data.colorOverride

  const onResize = useCallback(
    (_event: unknown, params: { width: number; height: number }) => {
      rf.setNodes((nds) =>
        nds.map((n) =>
          n.id === props.id
            ? {
                ...n,
                data: {
                  ...(n.data ?? {}),
                  assetWidth: Math.round(params.width),
                  assetHeight: Math.round(params.height),
                },
              }
            : n,
        ),
      )
    },
    [props.id, rf],
  )

  // 计算颜色覆盖样式（仅 SVG）
  const colorStyle = useMemo(() => {
    if (!isSvg || !colorOverride?.color) return null
    const bg = gradientToCss(colorOverride)
    if (!bg) return null
    return {
      background: bg,
      WebkitMaskImage: `url(${data.assetUrl})`,
      WebkitMaskSize: '100% 100%',
      WebkitMaskRepeat: 'no-repeat',
      maskImage: `url(${data.assetUrl})`,
      maskSize: '100% 100%',
      maskRepeat: 'no-repeat',
    } as React.CSSProperties
  }, [isSvg, colorOverride, data.assetUrl])

  return (
    <div
      style={{
        width: w,
        height: h,
        position: 'relative',
      }}
    >
      <NodeResizer
        minWidth={MIN_SIZE}
        minHeight={MIN_SIZE}
        onResize={onResize}
        handleStyle={{
          width: 12,
          height: 12,
          borderRadius: 9999,
          background: '#3b82f6',
          border: '2px solid #fff',
        }}
        lineStyle={{
          border: '1px dashed #3b82f6',
        }}
        isVisible={selected}
      />
      {colorStyle ? (
        // SVG 带颜色覆盖：使用 mask 技术
        <div
          style={{
            width: '100%',
            height: '100%',
            ...colorStyle,
          }}
        />
      ) : (
        // 原始图片显示
        <img
          src={data.assetUrl}
          alt={data.assetName ?? ''}
          style={{
            width: '100%',
            height: '100%',
            display: 'block',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
          draggable={false}
        />
      )}
    </div>
  )
}
