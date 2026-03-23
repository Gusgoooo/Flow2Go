import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Position,
  type EdgeProps,
  useReactFlow,
} from '@xyflow/react'
import styles from './overviewNodes.module.css'
import { padEdgeEndpoints } from '../edgeEndpointPad'

export function ButtonEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerStart,
    markerEnd,
    style,
    interactionWidth,
  } = props
  const rf = useReactFlow()

  const srcP = sourcePosition ?? Position.Right
  const tgtP = targetPosition ?? Position.Left
  const p = padEdgeEndpoints({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition: srcP,
    targetPosition: tgtP,
  })

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX: p.sourceX,
    sourceY: p.sourceY,
    sourcePosition: srcP,
    targetX: p.targetX,
    targetY: p.targetY,
    targetPosition: tgtP,
    borderRadius: 12,
    offset: 24,
  })

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        markerStart={markerStart}
        markerEnd={markerEnd}
        style={style}
        interactionWidth={interactionWidth ?? 24}
      />
      <EdgeLabelRenderer>
        <div
          className={styles.edgeLabel}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          <button
            className={styles.edgeBtn}
            type="button"
            onClick={() => rf.setEdges((eds) => eds.filter((e) => e.id !== id))}
          >
            ×
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

