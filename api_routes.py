"""
Server-side API routes for the Pose Skeleton Editor.
Frames are served one-at-a-time as JPEG images to avoid
multi-GB JSON responses on long clips.
"""

import io
import numpy as np
from PIL import Image
from aiohttp import web
from server import PromptServer

# Global frame cache: node_id -> {"original": tensor, "skeleton": tensor}
_frame_cache = {}


def cache_frames(node_id, original_frames, skeleton_frames):
    """Store frames (CPU copy) so the JS editor can retrieve them."""
    entry = {
        "original": original_frames.detach().cpu(),
        "skeleton": skeleton_frames.detach().cpu(),
    }
    _frame_cache[str(node_id)] = entry
    _frame_cache["_latest"] = entry
    print(f"[PoseEditor] Cached {original_frames.shape[0]} frames for node {node_id}")


def _resolve_cache(node_id):
    return _frame_cache.get(str(node_id)) or _frame_cache.get("_latest")


def _tensor_frame_to_jpeg(tensor):
    """HWC float[0,1] -> JPEG bytes."""
    arr = (tensor.numpy() * 255).clip(0, 255).astype(np.uint8)
    img = Image.fromarray(arr)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


@PromptServer.instance.routes.post("/pose_editor/get_info")
async def get_info(request):
    """Return metadata for cached frames — no image data."""
    try:
        data = await request.json()
        node_id = str(data.get("node_id", ""))
        cache = _resolve_cache(node_id)
        if cache is None:
            return web.json_response(
                {"error": "No frames cached. Queue the workflow once before opening the editor."},
                status=404,
            )
        orig = cache["original"]
        n, h, w, _ = orig.shape
        return web.json_response({
            "frame_count": int(n),
            "width": int(w),
            "height": int(h),
        })
    except Exception as e:
        import traceback
        traceback.print_exc()
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.get("/pose_editor/get_frame")
async def get_frame(request):
    """Return a single frame as a JPEG image."""
    try:
        node_id = request.query.get("node_id", "")
        kind = request.query.get("kind", "original")
        if kind not in ("original", "skeleton"):
            return web.Response(status=400, text="kind must be 'original' or 'skeleton'")
        try:
            idx = int(request.query.get("idx", "0"))
        except ValueError:
            return web.Response(status=400, text="Invalid idx")

        cache = _resolve_cache(node_id)
        if cache is None:
            return web.Response(status=404, text="No frames cached")

        tensor = cache[kind]
        if idx < 0 or idx >= tensor.shape[0]:
            return web.Response(status=404, text="Frame out of range")

        jpeg_bytes = _tensor_frame_to_jpeg(tensor[idx])
        return web.Response(
            body=jpeg_bytes,
            content_type="image/jpeg",
            headers={"Cache-Control": "no-cache"},
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        return web.Response(status=500, text=str(e))


@PromptServer.instance.routes.post("/pose_editor/get_frames")
async def get_frames_legacy(request):
    """Legacy endpoint — now returns info only (no bulk image dump)."""
    return await get_info(request)


@PromptServer.instance.routes.get("/pose_editor/debug")
async def list_cache(request):
    keys = [k for k in _frame_cache.keys() if k != "_latest"]
    has_latest = "_latest" in _frame_cache
    return web.json_response({"cached_nodes": keys, "has_latest": has_latest})
