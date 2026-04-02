import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

// ── DWPose Skeleton Definition ──────────────────────────────────────────────
const BODY_KEYPOINT_NAMES = [
    "nose", "neck",
    "R.shoulder", "R.elbow", "R.wrist",
    "L.shoulder", "L.elbow", "L.wrist",
    "R.hip", "R.knee", "R.ankle",
    "L.hip", "L.knee", "L.ankle",
    "R.eye", "L.eye",
    "R.ear", "L.ear",
];

const BODY_LIMB_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4], [1, 5], [5, 6], [6, 7],
    [1, 8], [8, 9], [9, 10], [1, 11], [11, 12], [12, 13],
    [0, 14], [0, 15], [14, 16], [15, 17],
];

const BODY_LIMB_COLORS = [
    "#FF0000", "#FF5500", "#FFAA00", "#FFFF00",
    "#AAFF00", "#55FF00", "#00FF00", "#00FF55",
    "#00FFAA", "#00FFFF", "#00AAFF", "#0055FF",
    "#0000FF", "#5500FF", "#AA00FF", "#FF00FF", "#FF00AA",
];

const BODY_JOINT_COLORS = [
    "#FF0000", "#FF5500", "#FFAA00", "#FFFF00", "#FFFF55",
    "#AAFF00", "#55FF00", "#00FF00", "#00FF55", "#00FFAA",
    "#00FFFF", "#00AAFF", "#0055FF", "#0000FF", "#5500FF",
    "#AA00FF", "#FF00FF", "#FF00AA",
];

const JOINT_RADIUS = 6;
const LIMB_THICKNESS = 4;
const HIT_RADIUS = 12; // Click detection radius

// ── Pose Editor Widget ──────────────────────────────────────────────────────

function createPoseEditorWidget(node) {
    // State
    let originalFrames = [];     // Array of Image objects
    let skeletonFrames = [];     // Array of Image objects
    let currentFrame = 0;
    let totalFrames = 0;
    let canvasWidth = 512;
    let canvasHeight = 512;
    let overlayOpacity = 0.5;

    // Keypoint edits: { frameIndex: [[x,y]|null, ...] }
    let keyframeEdits = {};
    let currentKeypoints = []; // Working keypoints for current frame (18 entries)

    // Interaction state
    let selectedJoint = -1;
    let dragging = false;
    let isPlaying = false;
    let playInterval = null;

    // Scale tracking
    let displayScale = 1;
    let offsetX = 0;
    let offsetY = 0;

    // ── Create the dialog / popup editor ──
    function openEditor() {
        const dialog = document.createElement("div");
        dialog.id = "pose-editor-dialog";
        dialog.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.92); z-index: 10000;
            display: flex; flex-direction: column; align-items: center;
            font-family: 'Segoe UI', system-ui, sans-serif; color: #e0e0e0;
        `;

        dialog.innerHTML = `
            <div style="
                width: 100%; max-width: 1200px; padding: 12px 20px;
                display: flex; flex-direction: column; height: 100vh; box-sizing: border-box;
            ">
                <!-- Header -->
                <div style="
                    display: flex; justify-content: space-between; align-items: center;
                    padding-bottom: 8px; border-bottom: 1px solid #333; margin-bottom: 8px;
                ">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <span style="font-size: 18px; font-weight: 700; color: #00FFAA;">
                            ✏️ Pose Skeleton Editor
                        </span>
                        <span id="pe-frame-label" style="
                            font-size: 13px; color: #888; font-variant-numeric: tabular-nums;
                        ">Frame 0 / 0</span>
                        <span id="pe-edit-indicator" style="
                            font-size: 11px; padding: 2px 8px; border-radius: 10px;
                            background: transparent; color: transparent;
                        ">●  KEYFRAME</span>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <button id="pe-btn-save" style="
                            background: #00FFAA; color: #000; border: none; padding: 6px 16px;
                            border-radius: 4px; font-weight: 600; cursor: pointer; font-size: 13px;
                        ">Save & Close</button>
                        <button id="pe-btn-cancel" style="
                            background: #333; color: #ccc; border: 1px solid #555; padding: 6px 16px;
                            border-radius: 4px; cursor: pointer; font-size: 13px;
                        ">Cancel</button>
                    </div>
                </div>

                <!-- Canvas Area -->
                <div style="flex: 1; display: flex; justify-content: center; align-items: center; min-height: 0; position: relative;">
                    <canvas id="pe-canvas" style="
                        cursor: crosshair;
                        border: 1px solid #333; border-radius: 4px;
                    "></canvas>
                </div>

                <!-- Controls Bar -->
                <div style="
                    padding-top: 10px; border-top: 1px solid #333; margin-top: 8px;
                    display: flex; flex-direction: column; gap: 8px;
                ">
                    <!-- Timeline -->
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <button id="pe-btn-prev" class="pe-ctrl-btn" title="Previous frame (←)">◀</button>
                        <button id="pe-btn-play" class="pe-ctrl-btn" title="Play/Pause (Space)">▶</button>
                        <button id="pe-btn-next" class="pe-ctrl-btn" title="Next frame (→)">▶▌</button>
                        <div style="flex: 1; position: relative; height: 28px;">
                            <div id="pe-timeline" style="
                                width: 100%; height: 6px; background: #222; border-radius: 3px;
                                position: absolute; top: 11px; cursor: pointer;
                            ">
                                <div id="pe-timeline-progress" style="
                                    height: 100%; background: #00FFAA; border-radius: 3px;
                                    width: 0%; transition: width 0.05s;
                                "></div>
                            </div>
                            <div id="pe-keyframe-markers" style="
                                position: absolute; top: 0; left: 0; right: 0; height: 28px;
                                pointer-events: none;
                            "></div>
                        </div>
                        <span id="pe-frame-num" style="
                            font-size: 12px; color: #888; min-width: 60px; text-align: right;
                            font-variant-numeric: tabular-nums;
                        ">0/0</span>
                    </div>

                    <!-- Tool buttons -->
                    <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                        <button id="pe-btn-set-kf" class="pe-tool-btn" title="Set current joints as keyframe (K)">
                            Set Keyframe
                        </button>
                        <button id="pe-btn-del-kf" class="pe-tool-btn" title="Delete keyframe for this frame (D)">
                            Delete Keyframe
                        </button>
                        <button id="pe-btn-copy-kf" class="pe-tool-btn" title="Copy keypoints from this frame (C)">
                            Copy
                        </button>
                        <button id="pe-btn-paste-kf" class="pe-tool-btn" title="Paste keypoints to this frame (V)">
                            Paste
                        </button>
                        <div style="width: 1px; height: 20px; background: #444; margin: 0 4px;"></div>
                        <button id="pe-btn-detect" class="pe-tool-btn" title="Extract joints from current skeleton frame">
                            Auto-Detect Joints
                        </button>
                        <button id="pe-btn-clear" class="pe-tool-btn" title="Clear all joints on this frame">
                            Clear Joints
                        </button>
                        <div style="flex: 1;"></div>
                        <label style="font-size: 12px; color: #888; display: flex; align-items: center; gap: 6px;">
                            Opacity
                            <input id="pe-opacity" type="range" min="0" max="100" value="50"
                                style="width: 80px; accent-color: #00FFAA;">
                        </label>
                        <label style="font-size: 12px; color: #888; display: flex; align-items: center; gap: 6px;">
                            <input id="pe-show-labels" type="checkbox" style="accent-color: #00FFAA;">
                            Labels
                        </label>
                    </div>

                    <!-- Joint info -->
                    <div id="pe-joint-info" style="
                        font-size: 11px; color: #666; height: 16px;
                        font-variant-numeric: tabular-nums;
                    "></div>
                </div>
            </div>

            <style>
                .pe-ctrl-btn {
                    background: #1a1a1a; color: #ccc; border: 1px solid #444;
                    width: 32px; height: 28px; border-radius: 4px; cursor: pointer;
                    font-size: 12px; display: flex; align-items: center; justify-content: center;
                }
                .pe-ctrl-btn:hover { background: #2a2a2a; border-color: #00FFAA; }
                .pe-tool-btn {
                    background: #1a1a1a; color: #aaa; border: 1px solid #444;
                    padding: 4px 10px; border-radius: 4px; cursor: pointer;
                    font-size: 12px;
                }
                .pe-tool-btn:hover { background: #2a2a2a; border-color: #00FFAA; color: #fff; }
            </style>
        `;

        document.body.appendChild(dialog);

        // ── Wire up events ──
        const canvas = document.getElementById("pe-canvas");
        const ctx = canvas.getContext("2d");

        let clipboardKeypoints = null;
        let showLabels = false;

        function updateFrameLabel() {
            document.getElementById("pe-frame-label").textContent =
                `Frame ${currentFrame} / ${totalFrames - 1}`;
            document.getElementById("pe-frame-num").textContent =
                `${currentFrame}/${totalFrames - 1}`;

            const pct = totalFrames > 1 ? (currentFrame / (totalFrames - 1)) * 100 : 0;
            document.getElementById("pe-timeline-progress").style.width = pct + "%";

            const isKf = keyframeEdits.hasOwnProperty(currentFrame);
            const indicator = document.getElementById("pe-edit-indicator");
            if (isKf) {
                indicator.style.background = "#00FFAA22";
                indicator.style.color = "#00FFAA";
                indicator.textContent = "● KEYFRAME";
            } else {
                indicator.style.background = "transparent";
                indicator.style.color = "transparent";
                indicator.textContent = "";
            }

            updateKeyframeMarkers();
        }

        function updateKeyframeMarkers() {
            const container = document.getElementById("pe-keyframe-markers");
            container.innerHTML = "";
            for (const idx of Object.keys(keyframeEdits)) {
                const frameIdx = parseInt(idx);
                const pct = totalFrames > 1 ? (frameIdx / (totalFrames - 1)) * 100 : 0;
                const marker = document.createElement("div");
                marker.style.cssText = `
                    position: absolute; left: ${pct}%; top: 2px;
                    width: 6px; height: 6px; border-radius: 50%;
                    background: #00FFAA; transform: translateX(-50%);
                `;
                marker.title = `Keyframe ${frameIdx}`;
                container.appendChild(marker);
            }
        }

        function loadCurrentKeypoints() {
            if (keyframeEdits.hasOwnProperty(currentFrame)) {
                currentKeypoints = JSON.parse(JSON.stringify(keyframeEdits[currentFrame]));
            } else {
                // Initialize empty 18-joint array
                currentKeypoints = new Array(18).fill(null);
            }
        }

        function drawFrame() {
            if (totalFrames === 0) return;

            const origImg = originalFrames[currentFrame];
            const skelImg = skeletonFrames[currentFrame];

            // Fit canvas to container while maintaining aspect ratio
            const container = canvas.parentElement;
            const maxW = container.clientWidth - 20;
            const maxH = container.clientHeight - 20;
            const scale = Math.min(maxW / canvasWidth, maxH / canvasHeight, 1);

            canvas.width = canvasWidth;
            canvas.height = canvasHeight;
            canvas.style.width = (canvasWidth * scale) + "px";
            canvas.style.height = (canvasHeight * scale) + "px";
            displayScale = scale;

            ctx.clearRect(0, 0, canvasWidth, canvasHeight);

            // Draw original frame
            if (origImg && origImg.complete) {
                ctx.globalAlpha = 1.0;
                ctx.drawImage(origImg, 0, 0, canvasWidth, canvasHeight);
            }

            // Draw skeleton frame (with opacity)
            if (skelImg && skelImg.complete) {
                ctx.globalAlpha = overlayOpacity;
                ctx.drawImage(skelImg, 0, 0, canvasWidth, canvasHeight);
            }

            ctx.globalAlpha = 1.0;

            // Draw edited/current keypoints on top
            if (currentKeypoints && currentKeypoints.some(k => k !== null)) {
                drawSkeleton(ctx, currentKeypoints);
            }
        }

        function drawSkeleton(ctx, keypoints) {
            // Draw limbs
            for (let i = 0; i < BODY_LIMB_CONNECTIONS.length; i++) {
                const [idxA, idxB] = BODY_LIMB_CONNECTIONS[i];
                const kpA = keypoints[idxA];
                const kpB = keypoints[idxB];
                if (!kpA || !kpB) continue;
                if ((kpA[0] === 0 && kpA[1] === 0) || (kpB[0] === 0 && kpB[1] === 0)) continue;

                ctx.strokeStyle = BODY_LIMB_COLORS[i] || "#FFFFFF";
                ctx.lineWidth = LIMB_THICKNESS;
                ctx.lineCap = "round";
                ctx.beginPath();
                ctx.moveTo(kpA[0], kpA[1]);
                ctx.lineTo(kpB[0], kpB[1]);
                ctx.stroke();
            }

            // Draw joints
            for (let i = 0; i < keypoints.length; i++) {
                const kp = keypoints[i];
                if (!kp || (kp[0] === 0 && kp[1] === 0)) continue;

                const isSelected = (i === selectedJoint);
                const radius = isSelected ? JOINT_RADIUS + 3 : JOINT_RADIUS;

                // Outer ring for selected
                if (isSelected) {
                    ctx.strokeStyle = "#FFFFFF";
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(kp[0], kp[1], radius + 2, 0, Math.PI * 2);
                    ctx.stroke();
                }

                ctx.fillStyle = BODY_JOINT_COLORS[i] || "#FFFFFF";
                ctx.beginPath();
                ctx.arc(kp[0], kp[1], radius, 0, Math.PI * 2);
                ctx.fill();

                // Label
                if (showLabels) {
                    ctx.fillStyle = "#FFFFFF";
                    ctx.font = "10px monospace";
                    ctx.fillText(BODY_KEYPOINT_NAMES[i], kp[0] + radius + 4, kp[1] + 3);
                }
            }
        }

        function canvasToImageCoords(e) {
            const rect = canvas.getBoundingClientRect();
            // Compute actual scale from rendered size vs internal resolution
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;
            const x = (e.clientX - rect.left) * scaleX;
            const y = (e.clientY - rect.top) * scaleY;
            return [x, y];
        }

        function findNearestJoint(x, y) {
            let best = -1;
            let bestDist = HIT_RADIUS + 8;
            for (let i = 0; i < currentKeypoints.length; i++) {
                const kp = currentKeypoints[i];
                if (!kp) continue;
                const dx = kp[0] - x;
                const dy = kp[1] - y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = i;
                }
            }
            return best;
        }

        function findNearestEmptySlot(x, y) {
            // For adding new joints: find the closest unplaced joint
            // by checking which joint type makes spatial sense
            for (let i = 0; i < 18; i++) {
                if (currentKeypoints[i] === null) return i;
            }
            return -1;
        }

        // ── Canvas mouse events ──
        canvas.addEventListener("mousedown", (e) => {
            const [x, y] = canvasToImageCoords(e);
            const joint = findNearestJoint(x, y);

            if (e.button === 2) {
                // Right-click: remove joint
                e.preventDefault();
                if (joint >= 0) {
                    currentKeypoints[joint] = null;
                    selectedJoint = -1;
                    drawFrame();
                }
                return;
            }

            if (joint >= 0) {
                // Click on existing joint: select and start drag
                selectedJoint = joint;
                dragging = true;
            } else if (e.shiftKey) {
                // Shift+click: open joint picker to choose which joint to place
                showJointPicker(e.clientX, e.clientY, x, y);
            }
            drawFrame();
            updateJointInfo(x, y);
        });

        canvas.addEventListener("mousemove", (e) => {
            const [x, y] = canvasToImageCoords(e);
            if (dragging && selectedJoint >= 0) {
                currentKeypoints[selectedJoint] = [x, y];
                drawFrame();
            }
            updateJointInfo(x, y);
        });

        canvas.addEventListener("mouseup", () => {
            dragging = false;
        });

        canvas.addEventListener("mouseleave", () => {
            dragging = false;
        });

        canvas.addEventListener("contextmenu", (e) => e.preventDefault());

        function updateJointInfo(x, y) {
            const info = document.getElementById("pe-joint-info");
            const joint = findNearestJoint(x, y);
            if (selectedJoint >= 0 && currentKeypoints[selectedJoint]) {
                const kp = currentKeypoints[selectedJoint];
                info.textContent = `Selected: ${BODY_KEYPOINT_NAMES[selectedJoint]} (${Math.round(kp[0])}, ${Math.round(kp[1])})`;
            } else if (joint >= 0) {
                info.textContent = `Hover: ${BODY_KEYPOINT_NAMES[joint]} — Click to select, Right-click to remove`;
            } else {
                info.textContent = `Shift+Click to place a new joint | Position: (${Math.round(x)}, ${Math.round(y)})`;
            }
        }

        // ── Joint selector popup (Shift+Click) ──
        // Override the simple findNearestEmptySlot with a picker
        canvas.addEventListener("dblclick", (e) => {
            const [x, y] = canvasToImageCoords(e);
            showJointPicker(e.clientX, e.clientY, x, y);
        });

        function showJointPicker(screenX, screenY, imgX, imgY) {
            // Remove existing picker
            const existing = document.getElementById("pe-joint-picker");
            if (existing) existing.remove();

            const picker = document.createElement("div");
            picker.id = "pe-joint-picker";
            picker.style.cssText = `
                position: fixed; left: ${screenX}px; top: ${screenY}px;
                background: #1a1a1a; border: 1px solid #00FFAA; border-radius: 6px;
                padding: 4px; z-index: 10001; max-height: 300px; overflow-y: auto;
                box-shadow: 0 4px 20px rgba(0,255,170,0.2);
            `;

            for (let i = 0; i < 18; i++) {
                const btn = document.createElement("div");
                const placed = currentKeypoints[i] !== null;
                btn.style.cssText = `
                    padding: 4px 10px; cursor: pointer; font-size: 12px;
                    color: ${placed ? '#666' : '#e0e0e0'}; display: flex;
                    align-items: center; gap: 8px; border-radius: 3px;
                `;
                btn.innerHTML = `
                    <span style="
                        width: 10px; height: 10px; border-radius: 50%;
                        background: ${BODY_JOINT_COLORS[i]}; display: inline-block;
                    "></span>
                    ${BODY_KEYPOINT_NAMES[i]} ${placed ? '(placed)' : ''}
                `;
                btn.addEventListener("mouseenter", () => {
                    btn.style.background = "#2a2a2a";
                });
                btn.addEventListener("mouseleave", () => {
                    btn.style.background = "transparent";
                });
                btn.addEventListener("click", () => {
                    currentKeypoints[i] = [imgX, imgY];
                    selectedJoint = i;
                    picker.remove();
                    drawFrame();
                });
                picker.appendChild(btn);
            }

            document.body.appendChild(picker);

            // Close on click outside
            const closeHandler = (ev) => {
                if (!picker.contains(ev.target)) {
                    picker.remove();
                    document.removeEventListener("mousedown", closeHandler);
                }
            };
            setTimeout(() => document.addEventListener("mousedown", closeHandler), 50);
        }

        // ── Navigation ──
        function goToFrame(idx) {
            if (idx < 0) idx = 0;
            if (idx >= totalFrames) idx = totalFrames - 1;
            currentFrame = idx;
            loadCurrentKeypoints();
            drawFrame();
            updateFrameLabel();
        }

        document.getElementById("pe-btn-prev").addEventListener("click", () => goToFrame(currentFrame - 1));
        document.getElementById("pe-btn-next").addEventListener("click", () => goToFrame(currentFrame + 1));
        document.getElementById("pe-btn-play").addEventListener("click", () => {
            isPlaying = !isPlaying;
            document.getElementById("pe-btn-play").textContent = isPlaying ? "⏸" : "▶";
            if (isPlaying) {
                playInterval = setInterval(() => {
                    if (currentFrame >= totalFrames - 1) {
                        currentFrame = 0;
                    } else {
                        currentFrame++;
                    }
                    loadCurrentKeypoints();
                    drawFrame();
                    updateFrameLabel();
                }, 100);
            } else {
                clearInterval(playInterval);
            }
        });

        // Timeline click
        document.getElementById("pe-timeline").addEventListener("click", (e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            const frame = Math.round(pct * (totalFrames - 1));
            goToFrame(frame);
        });

        // ── Keyframe operations ──
        document.getElementById("pe-btn-set-kf").addEventListener("click", () => {
            keyframeEdits[currentFrame] = JSON.parse(JSON.stringify(currentKeypoints));
            updateFrameLabel();
            drawFrame();
        });

        document.getElementById("pe-btn-del-kf").addEventListener("click", () => {
            delete keyframeEdits[currentFrame];
            loadCurrentKeypoints();
            updateFrameLabel();
            drawFrame();
        });

        document.getElementById("pe-btn-copy-kf").addEventListener("click", () => {
            clipboardKeypoints = JSON.parse(JSON.stringify(currentKeypoints));
        });

        document.getElementById("pe-btn-paste-kf").addEventListener("click", () => {
            if (clipboardKeypoints) {
                currentKeypoints = JSON.parse(JSON.stringify(clipboardKeypoints));
                drawFrame();
            }
        });

        document.getElementById("pe-btn-clear").addEventListener("click", () => {
            currentKeypoints = new Array(18).fill(null);
            selectedJoint = -1;
            drawFrame();
        });

        document.getElementById("pe-btn-detect").addEventListener("click", () => {
            // Try to auto-detect joints from the skeleton frame colors
            autoDetectJoints();
            drawFrame();
        });

        // ── Opacity slider ──
        document.getElementById("pe-opacity").addEventListener("input", (e) => {
            overlayOpacity = parseInt(e.target.value) / 100;
            drawFrame();
        });

        // ── Labels checkbox ──
        document.getElementById("pe-show-labels").addEventListener("change", (e) => {
            showLabels = e.target.checked;
            drawFrame();
        });

        // ── Keyboard shortcuts ──
        function handleKeyboard(e) {
            if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;

            switch (e.key) {
                case "ArrowLeft":
                    e.preventDefault();
                    goToFrame(currentFrame - 1);
                    break;
                case "ArrowRight":
                    e.preventDefault();
                    goToFrame(currentFrame + 1);
                    break;
                case " ":
                    e.preventDefault();
                    document.getElementById("pe-btn-play").click();
                    break;
                case "k":
                case "K":
                    document.getElementById("pe-btn-set-kf").click();
                    break;
                case "d":
                case "D":
                    document.getElementById("pe-btn-del-kf").click();
                    break;
                case "c":
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        document.getElementById("pe-btn-copy-kf").click();
                    }
                    break;
                case "v":
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        document.getElementById("pe-btn-paste-kf").click();
                    }
                    break;
                case "Escape":
                    dialog.remove();
                    document.removeEventListener("keydown", handleKeyboard);
                    if (playInterval) clearInterval(playInterval);
                    break;
                case "Delete":
                case "Backspace":
                    if (selectedJoint >= 0) {
                        currentKeypoints[selectedJoint] = null;
                        selectedJoint = -1;
                        drawFrame();
                    }
                    break;
                // Number keys 0-9 to select joints directly
                default:
                    if (e.key >= "0" && e.key <= "9") {
                        const num = parseInt(e.key);
                        // With shift: 10-17, without: 0-9
                        const jointIdx = e.shiftKey ? num + 10 : num;
                        if (jointIdx < 18) {
                            selectedJoint = jointIdx;
                            drawFrame();
                        }
                    }
            }
        }
        document.addEventListener("keydown", handleKeyboard);

        // ── Auto-detect joints from skeleton image ──
        function autoDetectJoints() {
            const skelImg = skeletonFrames[currentFrame];
            if (!skelImg) return;

            // Draw skeleton image to a temp canvas and read pixels
            const tmpCanvas = document.createElement("canvas");
            tmpCanvas.width = canvasWidth;
            tmpCanvas.height = canvasHeight;
            const tmpCtx = tmpCanvas.getContext("2d");
            tmpCtx.drawImage(skelImg, 0, 0, canvasWidth, canvasHeight);
            const imageData = tmpCtx.getImageData(0, 0, canvasWidth, canvasHeight);
            const pixels = imageData.data;

            // For each joint color, find the centroid of matching pixels
            for (let j = 0; j < BODY_JOINT_COLORS.length; j++) {
                const targetHex = BODY_JOINT_COLORS[j];
                const tr = parseInt(targetHex.slice(1, 3), 16);
                const tg = parseInt(targetHex.slice(3, 5), 16);
                const tb = parseInt(targetHex.slice(5, 7), 16);

                let sumX = 0, sumY = 0, count = 0;
                const tolerance = 30;

                for (let y = 0; y < canvasHeight; y++) {
                    for (let x = 0; x < canvasWidth; x++) {
                        const idx = (y * canvasWidth + x) * 4;
                        const r = pixels[idx];
                        const g = pixels[idx + 1];
                        const b = pixels[idx + 2];
                        const a = pixels[idx + 3];

                        if (a < 128) continue;
                        if (Math.abs(r - tr) < tolerance &&
                            Math.abs(g - tg) < tolerance &&
                            Math.abs(b - tb) < tolerance) {
                            sumX += x;
                            sumY += y;
                            count++;
                        }
                    }
                }

                if (count > 3) {
                    currentKeypoints[j] = [sumX / count, sumY / count];
                }
            }
        }

        // ── Save & Cancel ──
        document.getElementById("pe-btn-save").addEventListener("click", () => {
            // Save current frame edits if joints exist
            if (currentKeypoints.some(k => k !== null)) {
                keyframeEdits[currentFrame] = JSON.parse(JSON.stringify(currentKeypoints));
            }

            // Write back to the node's widget
            const jsonWidget = node.widgets.find(w => w.name === "keypoint_edits_json");
            if (jsonWidget) {
                jsonWidget.value = JSON.stringify(keyframeEdits);
            }

            dialog.remove();
            document.removeEventListener("keydown", handleKeyboard);
            if (playInterval) clearInterval(playInterval);
        });

        document.getElementById("pe-btn-cancel").addEventListener("click", () => {
            dialog.remove();
            document.removeEventListener("keydown", handleKeyboard);
            if (playInterval) clearInterval(playInterval);
        });

        // ── Load images from node inputs ──
        loadImagesFromNode().then(() => {
            loadCurrentKeypoints();
            drawFrame();
            updateFrameLabel();
        });
    }

    async function loadImagesFromNode() {
        try {
            const response = await api.fetchApi("/pose_editor/get_frames", {
                method: "POST",
                body: JSON.stringify({ node_id: node.id }),
                headers: { "Content-Type": "application/json" },
            });

            if (response.ok) {
                const data = await response.json();
                canvasWidth = data.width;
                canvasHeight = data.height;
                totalFrames = data.frame_count;

                // Load frame images
                const loadImage = (src) => new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => resolve(img);
                    img.onerror = () => resolve(null);
                    img.src = src;
                });

                originalFrames = await Promise.all(
                    data.original_urls.map(url => loadImage(url))
                );
                skeletonFrames = await Promise.all(
                    data.skeleton_urls.map(url => loadImage(url))
                );
                console.log(`PoseEditor: Loaded ${totalFrames} frames (${canvasWidth}x${canvasHeight})`);
            } else {
                const errData = await response.json().catch(() => ({}));
                const errMsg = errData.error || `HTTP ${response.status}`;
                console.error("PoseEditor: API error:", errMsg);
                alert(`Pose Editor: ${errMsg}\n\nMake sure to queue/run the workflow once before opening the editor.`);
                totalFrames = 0;
            }
        } catch (e) {
            console.error("PoseEditor: Could not load frames from API", e);
            alert(`Pose Editor: Failed to connect to frame API.\n\n${e.message}\n\nCheck the ComfyUI server console for errors.`);
            totalFrames = 0;
        }

        // Load existing edits from widget
        const jsonWidget = node.widgets.find(w => w.name === "keypoint_edits_json");
        if (jsonWidget && jsonWidget.value && jsonWidget.value !== "{}") {
            try {
                const parsed = JSON.parse(jsonWidget.value);
                // Convert string keys to int keys
                for (const [k, v] of Object.entries(parsed)) {
                    keyframeEdits[parseInt(k)] = v;
                }
            } catch (e) {
                console.warn("PoseEditor: Could not parse existing edits", e);
            }
        }
    }

    // ── Register the widget with the node ──
    const widget = node.addWidget("button", "Open Pose Editor", null, () => {
        openEditor();
    });
    widget.serialize = false;

    return widget;
}


// ── Register the node extension ──────────────────────────────────────────────

app.registerExtension({
    name: "PoseSkeletonEditor",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "PoseSkeletonEditor") {
            const origOnNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                origOnNodeCreated?.apply(this, arguments);
                createPoseEditorWidget(this);
            };
        }
    },
});
