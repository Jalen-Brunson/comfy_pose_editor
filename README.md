Two nodes:
Pose Skeleton Editor — The main node. Connect your original video frames and DWPose skeleton frames as IMAGE inputs. It has an "Open Pose Editor" button that launches a fullscreen interactive editor.
Pose Skeleton Overlay Preview — Simple utility node that blends original + skeleton at adjustable opacity for quick verification.
Editor workflow:

Your original footage shows as the background, skeleton overlaid with adjustable opacity
Click + drag existing joints to reposition them
Double-click anywhere to get a joint picker popup — select which joint type to place (nose, left elbow, etc.)
Shift+click to quickly add the next unplaced joint
Right-click a joint to remove it
Arrow keys to navigate frames, Space to play/pause
K to set a keyframe, D to delete one
Ctrl+C / Ctrl+V to copy/paste joint positions between frames
Auto-Detect button attempts to extract joint positions from the existing skeleton frame colors

Interpolation: Set keyframes on two frames and all frames between them get linearly interpolated automatically. The timeline shows green dots on keyframed frames.
Outputs: Corrected skeleton IMAGE batch + JSON string with all keypoint coordinates, frame dimensions, and which frames were edited.
One caveat — the frame serving relies on an API endpoint that caches tensors during execution. You'll need to run the workflow once first (it'll pass through the original skeletons unchanged), then click "Open Pose Editor" to make your corrections, then queue again to render the corrected output.
