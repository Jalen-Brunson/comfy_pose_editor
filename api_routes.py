"""
Server-side API routes for the Pose Skeleton Editor.
Uses the @routes decorator pattern for ComfyUI route registration.
"""

import io
import json
import base64
import torch
import numpy as np
from PIL import Image
from aiohttp import web
from server import PromptServer

# Global frame cache
_frame_cache = {}


def cache_frames(node_id, original_frames, skeleton_frames):
    """Store frames for a node so the JS editor can retrieve them."""
    entry = {
        "original": original_frames.clone(),
        "skeleton": skeleton_frames.clone(),
    }
    _frame_cache[str(node_id)] = entry
    _frame_cache["_latest"] = entry
    print(f"[PoseEditor] Cached {original_frames.shape[0]} frames for node {node_id}")


def tensor_to_base64(tensor):
    """Convert HWC float32 tensor to base64 JPEG."""
    arr = (tensor.cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
    img = Image.fromarray(arr)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


@PromptServer.instance.routes.post("/pose_editor/get_frames")
async def get_frames(request):
    """API endpoint: return frame data for the editor."""
    try:
        data = await request.json()
        node_id = str(data.get("node_id", ""))

        cache = _frame_cache.get(node_id) or _frame_cache.get("_latest")

        if cache is None:
            return web.json_response(
                {"error": "No frames cached. Queue the workflow once before opening the editor."},
                status=404,
            )

        orig = cache["original"]
        skel = cache["skeleton"]

        num_frames = orig.shape[0]
        _, h, w, _ = orig.shape

        original_urls = [tensor_to_base64(orig[i]) for i in range(num_frames)]
        skeleton_urls = [tensor_to_base64(skel[i]) for i in range(num_frames)]

        return web.json_response({
            "frame_count": num_frames,
            "width": w,
            "height": h,
            "original_urls": original_urls,
            "skeleton_urls": skeleton_urls,
        })

    except Exception as e:
        import traceback
        traceback.print_exc()
        return web.json_response({"error": str(e)}, status=500)


@PromptServer.instance.routes.get("/pose_editor/debug")
async def list_cache(request):
    """Debug endpoint: list cached node IDs."""
    keys = [k for k in _frame_cache.keys() if k != "_latest"]
    has_latest = "_latest" in _frame_cache
    return web.json_response({"cached_nodes": keys, "has_latest": has_latest})
