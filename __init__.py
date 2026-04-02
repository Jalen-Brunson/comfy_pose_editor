from .pose_editor_node import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS

WEB_DIRECTORY = "./js"

# Import api_routes to trigger route registration via decorators
try:
    from . import api_routes
    print("[PoseEditor] API routes registered successfully")
except Exception as e:
    print(f"[PoseEditor] WARNING: Failed to register API routes: {e}")

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
