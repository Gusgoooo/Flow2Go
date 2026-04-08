from pptx.util import Emu


def map_rect_to_ppt(
    *,
    node_x: float,
    node_y: float,
    node_w: float,
    node_h: float,
    slide_w_px: float,
    slide_h_px: float,
    ppt_w: Emu,
    ppt_h: Emu,
):
    """比例映射：1440x800 (或 payload 中的 slide size) -> PPT 实际宽高（EMU）。"""
    sw = max(1.0, float(slide_w_px))
    sh = max(1.0, float(slide_h_px))
    x = int(node_x / sw * int(ppt_w))
    y = int(node_y / sh * int(ppt_h))
    w = int(node_w / sw * int(ppt_w))
    h = int(node_h / sh * int(ppt_h))
    return x, y, max(1, w), max(1, h)

