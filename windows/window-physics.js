/**
 * window-physics.js — Shared window drag with physics.
 *
 * Features:
 *   - Left-click drag (standard)
 *   - Elasticity: momentum + bounce off screen edges on release
 *   - Magnetism: snap to nearby window edges during drag
 *   - Middle-click drag: move all visible windows simultaneously
 *
 * Usage:
 *   initPhysicsDrag(blobBody, 'button, input, .scroll-area');
 *
 * Settings are synced via localStorage + gel events.
 */

(function () {
    'use strict';

    // ── Physics constants ────────────────────────────────────
    const FRICTION = 0.92;           // velocity multiplier per frame
    const MIN_VELOCITY = 0.5;        // stop threshold (px/frame)
    const BOUNCE_DAMPING = 0.6;      // energy kept on edge bounce
    const SNAP_DISTANCE = 18;        // magnetism engage distance (px)
    const SNAP_STRENGTH = 0.7;       // 0..1, how hard the snap pulls
    const VELOCITY_SAMPLES = 4;      // recent moves to average for release velocity

    // ── State ────────────────────────────────────────────────
    let elasticity = JSON.parse(localStorage.getItem('gel:physics:elasticity') || 'false');
    let magnetism = JSON.parse(localStorage.getItem('gel:physics:magnetism') || 'false');
    let coastingRaf = null;

    // Listen for settings changes from the settings window
    if (window.gel && window.gel.onPhysicsSettings) {
        window.gel.onPhysicsSettings((s) => {
            if (s.elasticity !== undefined) {
                elasticity = s.elasticity;
                localStorage.setItem('gel:physics:elasticity', JSON.stringify(elasticity));
            }
            if (s.magnetism !== undefined) {
                magnetism = s.magnetism;
                localStorage.setItem('gel:physics:magnetism', JSON.stringify(magnetism));
            }
        });
    }

    // ── Helpers ──────────────────────────────────────────────

    function stopCoasting() {
        if (coastingRaf) {
            cancelAnimationFrame(coastingRaf);
            coastingRaf = null;
        }
    }

    // Get screen bounds (approximation — works for primary monitor)
    function getScreenBounds() {
        return {
            left: 0,
            top: 0,
            right: window.screen.availWidth,
            bottom: window.screen.availHeight,
        };
    }

    // ── Main init ────────────────────────────────────────────

    function initPhysicsDrag(blobBody, interactiveSelector) {
        blobBody.addEventListener('mousedown', async (e) => {
            const isMiddle = e.button === 1;
            const isLeft = e.button === 0;
            if (!isLeft && !isMiddle) return;

            // Don't drag from interactive elements
            if (interactiveSelector && e.target.closest(interactiveSelector)) return;

            // Stop any ongoing coast animation
            stopCoasting();

            // ── Middle-click: drag ALL windows ───────────────
            if (isMiddle) {
                e.preventDefault();
                let startX = e.screenX, startY = e.screenY;
                blobBody.classList.add('dragging');

                const onMove = (e2) => {
                    const dx = e2.screenX - startX;
                    const dy = e2.screenY - startY;
                    startX = e2.screenX;
                    startY = e2.screenY;
                    window.gel.dragAllWindows(dx, dy);
                };
                const onUp = () => {
                    blobBody.classList.remove('dragging');
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
                return;
            }

            // ── Left-click drag ──────────────────────────────

            // If no physics features enabled, use native drag when available
            if (!elasticity && !magnetism && window.gel._startNativeDrag) {
                window.gel._startNativeDrag();
                return;
            }

            // IPC-based drag with physics
            let dragging = true;
            let startX = e.screenX, startY = e.screenY;
            blobBody.classList.add('dragging');

            // Velocity tracking for elasticity
            const velocityHistory = [];
            let lastTime = performance.now();

            // Window label (needed for both magnetism and elasticity bounce)
            let myLabel = window.gel.getLabel();
            let snappedX = false, snappedY = false;

            const onMove = async (e2) => {
                if (!dragging) return;
                let dx = e2.screenX - startX;
                let dy = e2.screenY - startY;
                startX = e2.screenX;
                startY = e2.screenY;

                // Track velocity
                const now = performance.now();
                const dt = now - lastTime;
                lastTime = now;
                if (dt > 0) {
                    velocityHistory.push({ vx: dx / (dt / 16.67), vy: dy / (dt / 16.67) });
                    if (velocityHistory.length > VELOCITY_SAMPLES) velocityHistory.shift();
                }

                // Magnetism: snap to nearby window edges
                if (magnetism) {
                    try {
                        const positions = await window.gel.getAllWindowPositions();
                        const me = positions.find(w => w.label === myLabel);
                        if (me) {
                            const myRight = me.x + me.width;
                            const myBottom = me.y + me.height;
                            let snapDx = 0, snapDy = 0;
                            snappedX = false;
                            snappedY = false;

                            for (const other of positions) {
                                if (other.label === myLabel || !other.visible) continue;
                                const oRight = other.x + other.width;
                                const oBottom = other.y + other.height;

                                // Vertical overlap check (are windows at similar Y?)
                                const yOverlap = me.y < oBottom && myBottom > other.y;
                                // Horizontal overlap check
                                const xOverlap = me.x < oRight && myRight > other.x;

                                if (yOverlap) {
                                    // My right edge → other left edge
                                    const d1 = Math.abs((myRight + dx) - other.x);
                                    if (d1 < SNAP_DISTANCE) { snapDx = other.x - myRight; snappedX = true; }
                                    // My left edge → other right edge
                                    const d2 = Math.abs((me.x + dx) - oRight);
                                    if (d2 < SNAP_DISTANCE && (!snappedX || d2 < d1)) { snapDx = oRight - me.x; snappedX = true; }
                                    // Left-to-left alignment
                                    const d3 = Math.abs((me.x + dx) - other.x);
                                    if (d3 < SNAP_DISTANCE && !snappedX) { snapDx = other.x - me.x; snappedX = true; }
                                    // Right-to-right alignment
                                    const d4 = Math.abs((myRight + dx) - oRight);
                                    if (d4 < SNAP_DISTANCE && !snappedX) { snapDx = oRight - myRight; snappedX = true; }
                                }

                                if (xOverlap) {
                                    // My bottom → other top
                                    const d5 = Math.abs((myBottom + dy) - other.y);
                                    if (d5 < SNAP_DISTANCE) { snapDy = other.y - myBottom; snappedY = true; }
                                    // My top → other bottom
                                    const d6 = Math.abs((me.y + dy) - oBottom);
                                    if (d6 < SNAP_DISTANCE && (!snappedY || d6 < d5)) { snapDy = oBottom - me.y; snappedY = true; }
                                    // Top-to-top alignment
                                    const d7 = Math.abs((me.y + dy) - other.y);
                                    if (d7 < SNAP_DISTANCE && !snappedY) { snapDy = other.y - me.y; snappedY = true; }
                                    // Bottom-to-bottom alignment
                                    const d8 = Math.abs((myBottom + dy) - oBottom);
                                    if (d8 < SNAP_DISTANCE && !snappedY) { snapDy = oBottom - myBottom; snappedY = true; }
                                }
                            }

                            if (snappedX) dx = Math.round(dx * (1 - SNAP_STRENGTH) + snapDx * SNAP_STRENGTH);
                            if (snappedY) dy = Math.round(dy * (1 - SNAP_STRENGTH) + snapDy * SNAP_STRENGTH);
                        }
                    } catch (_) {}
                }

                window.gel.windowDrag(dx, dy);
            };

            const onUp = () => {
                dragging = false;
                blobBody.classList.remove('dragging');
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);

                // Elasticity: coast with momentum
                if (elasticity && velocityHistory.length > 0) {
                    let vx = 0, vy = 0;
                    for (const v of velocityHistory) { vx += v.vx; vy += v.vy; }
                    vx /= velocityHistory.length;
                    vy /= velocityHistory.length;

                    // Only coast if there's meaningful velocity
                    if (Math.abs(vx) < MIN_VELOCITY && Math.abs(vy) < MIN_VELOCITY) return;

                    const coast = async () => {
                        vx *= FRICTION;
                        vy *= FRICTION;

                        if (Math.abs(vx) < MIN_VELOCITY && Math.abs(vy) < MIN_VELOCITY) {
                            coastingRaf = null;
                            return;
                        }

                        // Bounce off screen edges
                        try {
                            const positions = await window.gel.getAllWindowPositions();
                            const me = positions.find(w => w.label === myLabel);
                            if (me) {
                                const bounds = getScreenBounds();
                                const nextX = me.x + vx;
                                const nextY = me.y + vy;
                                const nextR = nextX + me.width;
                                const nextB = nextY + me.height;

                                if (nextX < bounds.left) { vx = Math.abs(vx) * BOUNCE_DAMPING; }
                                if (nextR > bounds.right) { vx = -Math.abs(vx) * BOUNCE_DAMPING; }
                                if (nextY < bounds.top) { vy = Math.abs(vy) * BOUNCE_DAMPING; }
                                if (nextB > bounds.bottom) { vy = -Math.abs(vy) * BOUNCE_DAMPING; }
                            }
                        } catch (_) {}

                        window.gel.windowDrag(Math.round(vx), Math.round(vy));
                        coastingRaf = requestAnimationFrame(coast);
                    };
                    coastingRaf = requestAnimationFrame(coast);
                }
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    // Export
    window._initPhysicsDrag = initPhysicsDrag;

})();
