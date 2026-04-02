"""
Pose Skeleton Editor Node for ComfyUI
Allows interactive frame-by-frame editing of DWPose skeleton videos
with overlay on original footage, interpolation, and keypoint export.
"""

import torch
import numpy as np
import json
import os
import hashlib
from PIL import Image, ImageDraw

# ── DWPose / COCO-WholeBody Skeleton Definition ──────────────────────────────

# 18 body keypoints (COCO format used by DWPose body rendering)
BODY_KEYPOINT_NAMES = [
    "nose", "neck",
    "right_shoulder", "right_elbow", "right_wrist",
    "left_shoulder", "left_elbow", "left_wrist",
    "right_hip", "right_knee", "right_ankle",
    "left_hip", "left_knee", "left_ankle",
    "right_eye", "left_eye",
    "right_ear", "left_ear",
]

# Limb connections as pairs of keypoint indices
BODY_LIMB_CONNECTIONS = [
    (0, 1),   # nose -> neck
    (1, 2),   # neck -> right_shoulder
    (2, 3),   # right_shoulder -> right_elbow
    (3, 4),   # right_elbow -> right_wrist
    (1, 5),   # neck -> left_shoulder
    (5, 6),   # left_shoulder -> left_elbow
    (6, 7),   # left_elbow -> left_wrist
    (1, 8),   # neck -> right_hip
    (8, 9),   # right_hip -> right_knee
    (9, 10),  # right_knee -> right_ankle
    (1, 11),  # neck -> left_hip
    (11, 12), # left_hip -> left_knee
    (12, 13), # left_knee -> left_ankle
    (0, 14),  # nose -> right_eye
    (0, 15),  # nose -> left_eye
    (14, 16), # right_eye -> right_ear
    (15, 17), # left_eye -> left_ear
]

# DWPose limb colors (RGB) - matches the standard DWPose rendering
BODY_LIMB_COLORS = [
    (255, 0, 0),      # nose-neck: red
    (255, 85, 0),     # neck-rshoulder: orange-red
    (255, 170, 0),    # rshoulder-relbow: orange
    (255, 255, 0),    # relbow-rwrist: yellow
    (170, 255, 0),    # neck-lshoulder: yellow-green
    (85, 255, 0),     # lshoulder-lelbow: green
    (0, 255, 0),      # lelbow-lwrist: green
    (0, 255, 85),     # neck-rhip: green-cyan
    (0, 255, 170),    # rhip-rknee: cyan-green
    (0, 255, 255),    # rknee-rankle: cyan
    (0, 170, 255),    # neck-lhip: blue-cyan
    (0, 85, 255),     # lhip-lknee: blue
    (0, 0, 255),      # lknee-lankle: blue
    (85, 0, 255),     # nose-reye: purple
    (170, 0, 255),    # nose-leye: purple
    (255, 0, 255),    # reye-rear: magenta
    (255, 0, 170),    # leye-lear: pink
]

# Joint colors (one per keypoint)
BODY_JOINT_COLORS = [
    (255, 0, 0),      # nose
    (255, 85, 0),     # neck
    (255, 170, 0),    # right_shoulder
    (255, 255, 0),    # right_elbow
    (255, 255, 85),   # right_wrist
    (170, 255, 0),    # left_shoulder
    (85, 255, 0),     # left_elbow
    (0, 255, 0),      # left_wrist
    (0, 255, 85),     # right_hip
    (0, 255, 170),    # right_knee
    (0, 255, 255),    # right_ankle
    (0, 170, 255),    # left_hip
    (0, 85, 255),     # left_knee
    (0, 0, 255),      # left_ankle
    (85, 0, 255),     # right_eye
    (170, 0, 255),    # left_eye
    (255, 0, 255),    # right_ear
    (255, 0, 170),    # left_ear
]

LIMB_THICKNESS = 4
JOINT_RADIUS = 4


def render_skeleton(width, height, keypoints, background=None):
    """
    Render a pose skeleton from keypoints.
    keypoints: list of [x, y] or [x, y, confidence] or None for missing joints.
    background: optional PIL Image to overlay on, otherwise black.
    """
    if background is not None:
        img = background.copy().convert("RGB")
    else:
        img = Image.new("RGB", (width, height), (0, 0, 0))

    draw = ImageDraw.Draw(img)

    # Draw limbs
    for i, (idx_a, idx_b) in enumerate(BODY_LIMB_CONNECTIONS):
        if idx_a >= len(keypoints) or idx_b >= len(keypoints):
            continue
        kp_a = keypoints[idx_a]
        kp_b = keypoints[idx_b]
        if kp_a is None or kp_b is None:
            continue
        # Skip if coordinates are 0,0 (undetected)
        xa, ya = float(kp_a[0]), float(kp_a[1])
        xb, yb = float(kp_b[0]), float(kp_b[1])
        if (xa == 0 and ya == 0) or (xb == 0 and yb == 0):
            continue
        color = BODY_LIMB_COLORS[i] if i < len(BODY_LIMB_COLORS) else (255, 255, 255)
        draw.line([(xa, ya), (xb, yb)], fill=color, width=LIMB_THICKNESS)

    # Draw joints
    for i, kp in enumerate(keypoints):
        if kp is None:
            continue
        x, y = float(kp[0]), float(kp[1])
        if x == 0 and y == 0:
            continue
        color = BODY_JOINT_COLORS[i] if i < len(BODY_JOINT_COLORS) else (255, 255, 255)
        draw.ellipse(
            [x - JOINT_RADIUS, y - JOINT_RADIUS, x + JOINT_RADIUS, y + JOINT_RADIUS],
            fill=color,
        )

    return img


def interpolate_keypoints(kp_start, kp_end, num_frames):
    """
    Linearly interpolate between two keypoint sets over num_frames.
    Returns a list of keypoint arrays for the intermediate frames.
    """
    results = []
    for f in range(num_frames):
        t = (f + 1) / (num_frames + 1)
        frame_kps = []
        for i in range(max(len(kp_start), len(kp_end))):
            a = kp_start[i] if i < len(kp_start) else None
            b = kp_end[i] if i < len(kp_end) else None
            if a is not None and b is not None:
                x = a[0] + (b[0] - a[0]) * t
                y = a[1] + (b[1] - a[1]) * t
                frame_kps.append([x, y])
            elif a is not None:
                frame_kps.append([a[0], a[1]])
            elif b is not None:
                frame_kps.append([b[0], b[1]])
            else:
                frame_kps.append(None)
        results.append(frame_kps)
    return results


def tensor_to_pil(tensor):
    """Convert a single HWC float tensor [0,1] to PIL Image."""
    arr = (tensor.cpu().numpy() * 255).clip(0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def pil_to_tensor(pil_img):
    """Convert PIL Image to HWC float tensor [0,1]."""
    arr = np.array(pil_img).astype(np.float32) / 255.0
    return torch.from_numpy(arr)


class PoseSkeletonEditor:
    """
    Interactive pose skeleton editor for ComfyUI.
    Accepts original video frames and DWPose skeleton frames,
    allows frame-by-frame correction with interpolation support.
    Outputs corrected skeleton frames and raw keypoint JSON data.
    """

    CATEGORY = "pose"
    FUNCTION = "process"
    RETURN_TYPES = ("IMAGE", "STRING",)
    RETURN_NAMES = ("corrected_skeleton", "keypoint_json",)
    OUTPUT_IS_LIST = (False, False,)

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "original_frames": ("IMAGE",),
                "skeleton_frames": ("IMAGE",),
                "keypoint_edits_json": ("STRING", {
                    "default": "{}",
                    "multiline": True,
                    "dynamicPrompts": False,
                }),
            },
            "optional": {
                "limb_thickness": ("INT", {
                    "default": 4,
                    "min": 1,
                    "max": 12,
                    "step": 1,
                }),
                "joint_radius": ("INT", {
                    "default": 4,
                    "min": 2,
                    "max": 12,
                    "step": 1,
                }),
                "interpolate": ("BOOLEAN", {
                    "default": True,
                }),
                "overlay_opacity": ("FLOAT", {
                    "default": 0.5,
                    "min": 0.0,
                    "max": 1.0,
                    "step": 0.05,
                }),
            },
        }

    def process(
        self,
        original_frames,
        skeleton_frames,
        keypoint_edits_json,
        limb_thickness=4,
        joint_radius=4,
        interpolate=True,
        overlay_opacity=0.5,
    ):
        # Cache frames so the JS editor can fetch them
        try:
            from .api_routes import cache_frames
            cache_frames(id(self), original_frames, skeleton_frames)
        except Exception:
            pass

        global LIMB_THICKNESS, JOINT_RADIUS
        LIMB_THICKNESS = limb_thickness
        JOINT_RADIUS = joint_radius

        num_frames = original_frames.shape[0]
        _, h, w, _ = original_frames.shape

        # Parse edits
        try:
            edits = json.loads(keypoint_edits_json)
        except json.JSONDecodeError:
            edits = {}

        # edits format: { "frame_idx": [[x,y], [x,y], ...or null...], ... }
        # Keys are string frame indices, values are lists of 18 keypoints

        # Build the full keypoint timeline
        # Start with None for all frames (meaning: use original skeleton frame)
        all_keypoints = [None] * num_frames

        # Place explicit edits
        edited_frame_indices = sorted([int(k) for k in edits.keys() if k.isdigit()])
        for idx in edited_frame_indices:
            if 0 <= idx < num_frames:
                all_keypoints[idx] = edits[str(idx)]

        # Interpolate between edited keyframes if enabled
        if interpolate and len(edited_frame_indices) >= 2:
            for i in range(len(edited_frame_indices) - 1):
                start_idx = edited_frame_indices[i]
                end_idx = edited_frame_indices[i + 1]
                gap = end_idx - start_idx - 1
                if gap > 0:
                    kp_start = all_keypoints[start_idx]
                    kp_end = all_keypoints[end_idx]
                    if kp_start is not None and kp_end is not None:
                        interp = interpolate_keypoints(kp_start, kp_end, gap)
                        for j, kps in enumerate(interp):
                            frame_idx = start_idx + j + 1
                            if all_keypoints[frame_idx] is None:
                                all_keypoints[frame_idx] = kps

        # Render output frames
        output_frames = []
        final_keypoints = {}

        for i in range(num_frames):
            if all_keypoints[i] is not None:
                # Render corrected joints ON TOP of the original skeleton frame
                # This preserves any joints that weren't manually edited
                original_skel = tensor_to_pil(skeleton_frames[i])
                skeleton_img = render_skeleton(w, h, all_keypoints[i], background=original_skel)
                output_frames.append(pil_to_tensor(skeleton_img))
                final_keypoints[str(i)] = all_keypoints[i]
            else:
                # Use original skeleton frame as-is
                output_frames.append(skeleton_frames[i])
                # No keypoint data for unedited frames

        output_tensor = torch.stack(output_frames)
        keypoint_json_out = json.dumps({
            "frame_count": num_frames,
            "width": w,
            "height": h,
            "keypoint_names": BODY_KEYPOINT_NAMES,
            "limb_connections": BODY_LIMB_CONNECTIONS,
            "edited_frames": final_keypoints,
            "edited_frame_indices": edited_frame_indices,
        }, indent=2)

        return (output_tensor, keypoint_json_out,)


class PoseSkeletonEditorPreview:
    """
    Preview node that overlays skeleton on original frames
    for visual verification before/after editing.
    """

    CATEGORY = "pose"
    FUNCTION = "preview"
    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("overlay_preview",)

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "original_frames": ("IMAGE",),
                "skeleton_frames": ("IMAGE",),
                "overlay_opacity": ("FLOAT", {
                    "default": 0.5,
                    "min": 0.0,
                    "max": 1.0,
                    "step": 0.05,
                }),
            },
        }

    def preview(self, original_frames, skeleton_frames, overlay_opacity=0.5):
        num_frames = min(original_frames.shape[0], skeleton_frames.shape[0])
        output = []
        for i in range(num_frames):
            orig = tensor_to_pil(original_frames[i])
            skel = tensor_to_pil(skeleton_frames[i])
            blended = Image.blend(orig, skel, overlay_opacity)
            output.append(pil_to_tensor(blended))
        return (torch.stack(output),)


NODE_CLASS_MAPPINGS = {
    "PoseSkeletonEditor": PoseSkeletonEditor,
    "PoseSkeletonEditorPreview": PoseSkeletonEditorPreview,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PoseSkeletonEditor": "Pose Skeleton Editor ✏️",
    "PoseSkeletonEditorPreview": "Pose Skeleton Overlay Preview 👁️",
}
