import { GRID_UNIT, SIZE_STEP_RATIO } from '../grid'

export { EDGE_HANDLE_GAP_PX } from '../edges/edgeEndpointPad'

/** 正交路径浮点容差 */
export const ORTHO_EPS = 1e-6

/** 正交边网格吸附单位 */
export const EDGE_STEP_UNIT = Math.max(1, GRID_UNIT * SIZE_STEP_RATIO)

/** 绕行线与节点包络的额外间隙 */
export const ROUTE_CLEAR = 8

/** 路由安全区外扩像素 */
export const ROUTING_PAD_X = 24
export const ROUTING_PAD_Y = 24
