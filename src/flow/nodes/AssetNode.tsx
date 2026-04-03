import { useCallback, useMemo } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import { type GradientValue, gradientToCss } from '../style/GradientColorEditor'
import { GRID_UNIT, snapPointToGrid, snapSizeToGrid } from '../grid'

export type AssetNodeData = {
  assetUrl: string
  assetName?: string
  assetType?: 'svg' | 'png'
  assetWidth?: number
  assetHeight?: number
  colorOverride?: GradientValue
  /** 旋转角度（度数），顺时针，默认 0 */
  rotation?: number
  /** 水平翻转 */
  flipX?: boolean
  /** 垂直翻转 */
  flipY?: boolean
}

const DEFAULT_WIDTH = 120
const DEFAULT_HEIGHT = 80
const MIN_SIZE = 20

export function AssetNode(props: NodeProps) {
  const data = (props.data ?? {}) as AssetNodeData
  const rf = useReactFlow()
  const w = Math.max(data.assetWidth ?? DEFAULT_WIDTH, GRID_UNIT)
  const h = Math.max(data.assetHeight ?? DEFAULT_HEIGHT, GRID_UNIT)
  const selected = (props as any).selected
  const isSvg = data.assetType === 'svg'
  const colorOverride = data.colorOverride
   // 旋转角度（度数）
  const rotation = Number.isFinite(data.rotation) ? (data.rotation as number) : 0
  const flipX = Boolean(data.flipX)
  const flipY = Boolean(data.flipY)

  const onResize = useCallback(
    (_event: unknown, params: { x: number; y: number; width: number; height: number }) => {
      const { x, y, width, height } = params
      rf.setNodes((nds) =>
        nds.map((n) =>
          n.id === props.id
            ? {
                ...n,
                // 让 NodeResizer 计算的左上角作为新的 position，
                // 这样拖拽哪个角，视觉上就从哪个角拉伸，而不是绕中心缩放
                position:
                  Number.isFinite(x) && Number.isFinite(y)
                    ? snapPointToGrid({ x, y })
                    : n.position,
                data: {
                  ...(n.data ?? {}),
                  assetWidth: snapSizeToGrid(width),
                  assetHeight: snapSizeToGrid(height),
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
    const maskUrl = `url('${data.assetUrl}')`
    return {
      background: bg,
      WebkitMaskImage: maskUrl,
      WebkitMaskMode: 'alpha',
      WebkitMaskSize: '100% 100%',
      WebkitMaskPosition: 'center',
      WebkitMaskRepeat: 'no-repeat',
      maskImage: maskUrl,
      maskMode: 'alpha',
      maskSize: '100% 100%',
      maskPosition: 'center',
      maskRepeat: 'no-repeat',
    } as React.CSSProperties
  }, [isSvg, colorOverride, data.assetUrl])

  return (
    <div
      style={{
        width: w,
        height: h,
        position: 'relative',
        transform:
          flipX || flipY || rotation
            ? `${rotation ? `rotate(${rotation}deg) ` : ''}scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})`
            : undefined,
        transformOrigin: 'center center',
      }}
    >
      <NodeResizer
        minWidth={MIN_SIZE}
        minHeight={MIN_SIZE}
        onResize={onResize}
        handleStyle={{
          width: 8,
          height: 8,
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
            objectFit: isSvg ? 'fill' : 'contain',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
          draggable={false}
        />
      )}
    </div>
  )
}
