import { Position } from '@xyflow/react'
import { describe, expect, it } from 'vitest'
import { resolveDragNormalizeAnchorPreference } from '../edges/EditableSmoothStepEdge'

describe('resolveDragNormalizeAnchorPreference', () => {
  it('prefers target anchor when dragged parallel segment is closer to in side', () => {
    const anchor = resolveDragNormalizeAnchorPreference({
      movedPoints: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 90 },
        { x: 170, y: 90 },
        { x: 170, y: 100 },
        { x: 200, y: 100 },
      ],
      segIndex: 2,
      isVertical: false,
      source: { x: 0, y: 0 },
      target: { x: 200, y: 100 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    })
    expect(anchor).toBe('target')
  })

  it('prefers source anchor when dragged parallel segment is closer to out side', () => {
    const anchor = resolveDragNormalizeAnchorPreference({
      movedPoints: [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 10 },
        { x: 170, y: 10 },
        { x: 170, y: 100 },
        { x: 200, y: 100 },
      ],
      segIndex: 2,
      isVertical: false,
      source: { x: 0, y: 0 },
      target: { x: 200, y: 100 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    })
    expect(anchor).toBe('source')
  })

  it('infers target anchor for bridge segment between same-axis terminals', () => {
    const anchor = resolveDragNormalizeAnchorPreference({
      movedPoints: [
        { x: 0, y: 0 },
        { x: 0, y: -30 },
        { x: 120, y: -30 },
        { x: 220, y: -30 },
        { x: 200, y: 100 },
      ],
      segIndex: 2,
      isVertical: false,
      source: { x: 0, y: 0 },
      target: { x: 200, y: 100 },
      sourcePosition: Position.Top,
      targetPosition: Position.Bottom,
    })
    expect(anchor).toBe('target')
  })

  it('infers source anchor for bridge segment when closer to source(out)', () => {
    const anchor = resolveDragNormalizeAnchorPreference({
      movedPoints: [
        { x: 0, y: 0 },
        { x: 0, y: -30 },
        { x: 40, y: -30 },
        { x: 100, y: -30 },
        { x: 100, y: 100 },
      ],
      segIndex: 2,
      isVertical: false,
      source: { x: 0, y: 0 },
      target: { x: 100, y: 100 },
      sourcePosition: Position.Top,
      targetPosition: Position.Bottom,
    })
    expect(anchor).toBe('source')
  })

  it('prefers target anchor when axis distance ties but dragged segment is spatially closer to target(in)', () => {
    const anchor = resolveDragNormalizeAnchorPreference({
      movedPoints: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 40 },
        { x: 180, y: 40 },
        { x: 180, y: 0 },
        { x: 200, y: 0 },
      ],
      segIndex: 2,
      isVertical: false,
      source: { x: 0, y: 0 },
      target: { x: 200, y: 0 },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    })
    expect(anchor).toBe('target')
  })

  it('prefers target anchor when dragged segment is only parallel to target(in) terminal lead', () => {
    const anchor = resolveDragNormalizeAnchorPreference({
      movedPoints: [
        { x: 0, y: 0 },
        { x: 0, y: 60 },
        { x: 120, y: 60 },
        { x: 120, y: 100 },
        { x: 200, y: 100 },
      ],
      segIndex: 1,
      isVertical: false,
      source: { x: 0, y: 0 },
      target: { x: 200, y: 100 },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Left,
    })
    expect(anchor).toBe('target')
  })

  it('prefers source anchor when dragged segment is only parallel to source(out) terminal lead', () => {
    const anchor = resolveDragNormalizeAnchorPreference({
      movedPoints: [
        { x: 0, y: 0 },
        { x: 80, y: 0 },
        { x: 80, y: 60 },
        { x: 200, y: 60 },
        { x: 200, y: 100 },
      ],
      segIndex: 0,
      isVertical: false,
      source: { x: 0, y: 0 },
      target: { x: 200, y: 100 },
      sourcePosition: Position.Right,
      targetPosition: Position.Bottom,
    })
    expect(anchor).toBe('source')
  })
})
