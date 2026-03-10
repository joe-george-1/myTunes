/**
 * drag.js — Makes any .draggable element movable via pointer events
 * Interactive children (buttons, inputs, scrollable areas) are excluded from drag initiation
 */

const INTERACTIVE_SELECTORS = 'button, input, canvas, .file-list-scroll, .playlist-scroll, .seek-bar, .volume-knob, .file-item, .playlist-item, .gel-btn, .gel-btn-sm';

export function initDrag() {
    const modules = document.querySelectorAll('.draggable');
    modules.forEach(mod => makeDraggable(mod));
}

function makeDraggable(el) {
    let isDragging = false;
    let startX, startY, origX, origY;

    el.addEventListener('pointerdown', (e) => {
        // Don't drag if clicking interactive elements
        if (e.target.closest(INTERACTIVE_SELECTORS)) return;
        if (e.button !== 0) return;

        isDragging = true;
        el.classList.add('dragging');

        // Bring to front
        document.querySelectorAll('.module').forEach(m => m.style.zIndex = 10);
        el.style.zIndex = 9999;

        const rect = el.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        origX = rect.left;
        origY = rect.top;

        el.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    el.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        el.style.left = (origX + dx) + 'px';
        el.style.top = (origY + dy) + 'px';
    });

    el.addEventListener('pointerup', () => {
        isDragging = false;
        el.classList.remove('dragging');
    });

    el.addEventListener('lostpointercapture', () => {
        isDragging = false;
        el.classList.remove('dragging');
    });
}
