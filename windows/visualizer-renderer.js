/**
 * visualizer-renderer.js — Receives frequency data from player via IPC.
 * Renders bars + waveform (2D) or a raymarched nebula (3D).
 */

const canvas2d = document.getElementById('main-viz');
const canvas3d = document.getElementById('viz-3d');
const ctx = canvas2d.getContext('2d');
const blobBody = document.querySelector('.blob-body');
const btnToggle3d = document.getElementById('btn-toggle-3d');

let freqData = null;
let waveData = null;
let mode3d = false;

// ── Receive viz data from player window ─────────────────────
window.gel.onVizData((data) => {
    freqData = data.freq;
    waveData = data.wave;
});

// ── 3D Toggle ──────────────────────────────────────────────
const vizContainer = document.querySelector('.viz-container');

btnToggle3d.addEventListener('click', (e) => {
    e.stopPropagation();
    mode3d = !mode3d;
    canvas2d.style.display = mode3d ? 'none' : 'block';
    canvas3d.style.display = mode3d ? 'block' : 'none';
    btnToggle3d.classList.toggle('active', mode3d);
    // Transparent container in 3D mode so desktop shows through
    vizContainer.style.background = mode3d ? 'transparent' : '';
    vizContainer.style.boxShadow = mode3d ? 'none' : '';
    vizContainer.style.border = mode3d ? 'none' : '';
    if (mode3d && !glReady) initWebGL();
});

// ══════════════════════════════════════════════════════════════
//  2D VISUALIZER (bars + waveform)
// ══════════════════════════════════════════════════════════════

function draw2d() {
    requestAnimationFrame(draw2d);
    if (mode3d) return;

    const w = canvas2d.width = canvas2d.offsetWidth * devicePixelRatio;
    const h = canvas2d.height = canvas2d.offsetHeight * devicePixelRatio;
    ctx.clearRect(0, 0, w, h);

    if (!freqData || !waveData) {
        drawIdle(w, h);
        return;
    }

    drawBars(w, h);
    drawWaveform(w, h);
}
draw2d();

function drawBars(w, h) {
    const bars = Math.min(freqData.length, 64);
    const barW = w / bars;

    for (let i = 0; i < bars; i++) {
        const val = freqData[i] / 255;
        const barH = val * h * 0.88;
        const themeH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--theme-h')) || 210;
        const themeS = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--theme-s')) || 0;

        const light = 60 + val * 35;
        const alpha = 0.4 + val * 0.5;

        ctx.fillStyle = `hsla(${themeH}, ${themeS}%, ${light}%, ${alpha})`;
        ctx.fillRect(i * barW + 1, h - barH, barW - 2, barH);

        // Specular top on tall bars
        if (val > 0.3) {
            const grad = ctx.createLinearGradient(0, h - barH, 0, h - barH + barH * 0.15);
            grad.addColorStop(0, `rgba(255,255,255,${val * 0.2})`);
            grad.addColorStop(1, 'transparent');
            ctx.fillStyle = grad;
            ctx.fillRect(i * barW + 1, h - barH, barW - 2, barH * 0.15);
        }
    }
}

function drawWaveform(w, h) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1.5 * devicePixelRatio;
    ctx.beginPath();

    const sliceW = w / waveData.length;
    for (let i = 0; i < waveData.length; i++) {
        const v = waveData[i] / 128.0;
        const y = (v * h) / 2;
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * sliceW, y);
    }
    ctx.stroke();
}

function drawIdle(w, h) {
    const t = Date.now() * 0.001;
    const alpha = 0.03 + Math.sin(t * 0.5) * 0.015;
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.fillRect(0, 0, w, h);

    const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.4);
    grad.addColorStop(0, `rgba(255, 255, 255, ${0.04 + Math.sin(t) * 0.02})`);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
}

// ══════════════════════════════════════════════════════════════
//  3D VISUALIZER (raymarched neuron/nebula)
// ══════════════════════════════════════════════════════════════

let gl = null;
let glReady = false;
let glProgram = null;
let uTime, uResolution, uBass, uMid, uHigh, uEnergy, uThemeColor;
let glStartTime = 0;
// Smoothed audio values for fluid motion
let sBass = 0, sMid = 0, sHigh = 0, sEnergy = 0;

const VERT = `
attribute vec2 pos;
void main() { gl_Position = vec4(pos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;

uniform float uTime;
uniform vec2  uResolution;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uEnergy;
uniform vec3  uThemeColor;

// ── Noise ───────────────────────────────────────────
vec3 hash33(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
             dot(p, vec3(269.5, 183.3, 246.1)),
             dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453123) * 2.0 - 1.0;
}

float noise3d(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(dot(hash33(i), f),
                       dot(hash33(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                   mix(dot(hash33(i + vec3(0,1,0)), f - vec3(0,1,0)),
                       dot(hash33(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
               mix(mix(dot(hash33(i + vec3(0,0,1)), f - vec3(0,0,1)),
                       dot(hash33(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                   mix(dot(hash33(i + vec3(0,1,1)), f - vec3(0,1,1)),
                       dot(hash33(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
}

float fbm(vec3 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 3; i++) {
        v += a * noise3d(p);
        p *= 1.8;
        a *= 0.45;
    }
    return v;
}

// ── Icosahedron star SDF ────────────────────────────
// 12 vertices of a regular icosahedron (golden ratio construction)
// We use their directions as star spike axes

float icoStarField(vec3 p, float radius, float spikeLen) {
    // Golden ratio
    float phi = 1.618034;
    float iphi = 1.0 / phi;

    // Core sphere
    float d = length(p) - radius;

    // 12 icosahedron vertex directions (normalized)
    // Top/bottom caps
    vec3 v0 = normalize(vec3(0.0, 1.0, phi));
    vec3 v1 = normalize(vec3(0.0, -1.0, phi));
    vec3 v2 = normalize(vec3(0.0, 1.0, -phi));
    vec3 v3 = normalize(vec3(0.0, -1.0, -phi));
    vec3 v4 = normalize(vec3(1.0, phi, 0.0));
    vec3 v5 = normalize(vec3(-1.0, phi, 0.0));
    vec3 v6 = normalize(vec3(1.0, -phi, 0.0));
    vec3 v7 = normalize(vec3(-1.0, -phi, 0.0));
    vec3 v8 = normalize(vec3(phi, 0.0, 1.0));
    vec3 v9 = normalize(vec3(-phi, 0.0, 1.0));
    vec3 v10 = normalize(vec3(phi, 0.0, -1.0));
    vec3 v11 = normalize(vec3(-phi, 0.0, -1.0));

    // Star spikes — elongate along each vertex axis
    // Each spike is a capped cone approximated via line distance
    vec3 verts[12];
    verts[0] = v0; verts[1] = v1; verts[2] = v2; verts[3] = v3;
    verts[4] = v4; verts[5] = v5; verts[6] = v6; verts[7] = v7;
    verts[8] = v8; verts[9] = v9; verts[10] = v10; verts[11] = v11;

    for (int i = 0; i < 12; i++) {
        vec3 axis = verts[i];
        float proj = dot(p, axis);
        float dist = length(p - axis * proj);
        // Taper: thicker at base, thin at tip
        float taper = 0.06 + 0.05 * smoothstep(spikeLen, 0.0, proj);
        float spike = dist - taper;
        // Only count where projection is positive (outward from center) and within spike length
        spike = max(spike, -proj);
        spike = max(spike, proj - spikeLen);
        d = min(d, spike);
    }

    return d;
}

// ── Combined neuron field ───────────────────────────
float neuronField(vec3 p) {
    float t = uTime * 0.3;
    float bassX = uBass * uBass * uBass;  // cubed — quiet is tiny, loud explodes
    float midX = uMid * uMid;
    float highX = uHigh * uHigh;

    // Slow rotation of the whole form
    float rot = t * 0.15;
    float c = cos(rot), s = sin(rot);
    vec3 rp = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);

    // Icosahedron star core — capped max size
    float coreRadius = 0.04 + bassX * 0.4;
    float spikeLen = 0.1 + bassX * 0.5 + uEnergy * uEnergy * 0.3;
    float core = icoStarField(rp, coreRadius, spikeLen);

    // Mid-frequency noise — smoother, lower frequency, more reactive
    float warp = fbm(rp * 1.2 + t * 0.4) * (0.08 + midX * 1.0);
    core += warp;

    // Gentle surface detail — smooth undulation, not micro noise
    core += noise3d(rp * 3.0 + t * 0.6) * (0.03 + highX * 0.12);

    // Tendrils — emerge from star tips, high freq extends them
    float tendrils = 1e10;
    for (int i = 0; i < 8; i++) {
        float fi = float(i);
        float a1 = fi * 0.7854 + t * (0.12 + fi * 0.03);
        float a2 = fi * 1.1 + t * 0.08;
        vec3 dir = normalize(vec3(
            cos(a1) * cos(a2),
            sin(a2) * (0.7 + 0.3 * sin(fi * 3.0 + t)),
            sin(a1) * cos(a2)
        ));

        float proj = dot(p, dir);
        float dist = length(p - dir * proj);

        // Tendril thickness tapers along length, pulses with bass
        float thickness = 0.025 + 0.02 * sin(proj * 6.0 + t * 2.0) + bassX * 0.015;
        float arm = dist - thickness;

        // Tendril reach — extreme reactivity
        float reach = 0.5 + highX * 2.5 + uEnergy * 1.2;
        arm = max(arm, proj - reach);
        arm = max(arm, -proj - 0.1);

        // Smooth waviness along the tendril
        arm += sin(proj * 6.0 + t * 2.0 + fi) * 0.015 * (1.0 + midX * 1.5);

        tendrils = min(tendrils, arm);
    }

    // Smooth blend between core and tendrils (not hard min)
    float k = 0.15 + bassX * 0.1;
    float h = clamp(0.5 + 0.5 * (tendrils - core) / k, 0.0, 1.0);
    float d = mix(tendrils, core, h) - k * h * (1.0 - h);

    return d;
}

// ── Raymarching ─────────────────────────────────────
float march(vec3 ro, vec3 rd) {
    float t = 0.0;
    for (int i = 0; i < 64; i++) {
        float d = neuronField(ro + rd * t);
        if (d < 0.005) return t;
        t += d * 0.6;
        if (t > 8.0) break;
    }
    return -1.0;
}

vec3 calcNormal(vec3 p) {
    vec2 e = vec2(0.008, 0.0);
    return normalize(vec3(
        neuronField(p + e.xyy) - neuronField(p - e.xyy),
        neuronField(p + e.yxy) - neuronField(p - e.yxy),
        neuronField(p + e.yyx) - neuronField(p - e.yyx)
    ));
}

// ── Volumetric glow ─────────────────────────────────
vec3 nebulaGlow(vec3 ro, vec3 rd) {
    vec3 col = vec3(0.0);
    float t = 0.1;
    for (int i = 0; i < 40; i++) {
        vec3 p = ro + rd * t;
        float d = neuronField(p);
        if (d < 0.8) {
            float intensity = exp(-d * 7.0) * 0.025;
            // Color shifts with depth and noise
            float n = fbm(p * 3.0 + uTime * 0.15);
            // Complementary color for inner glow
            vec3 inner = vec3(uThemeColor.z, uThemeColor.x, uThemeColor.y);
            vec3 gc = mix(uThemeColor, inner, n * 0.4 + 0.2);
            gc = mix(gc, vec3(1.0), smoothstep(0.0, 0.15, -d) * 0.6);
            // Bass pumps the glow hard
            col += gc * intensity * (1.0 + uBass * 3.0 + uEnergy * 2.0);
        }
        t += 0.1;
        if (t > 5.0) break;
    }
    return col;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - uResolution * 0.5) / min(uResolution.x, uResolution.y);

    // Camera orbits — bass shakes it slightly
    float ct = uTime * 0.15;
    float camDist = 2.8 - uBass * 0.3;
    vec3 ro = vec3(sin(ct) * camDist, cos(ct * 0.7) * 0.6, cos(ct) * camDist);
    // Bass-reactive camera shake
    ro.x += sin(uTime * 7.0) * uBass * 0.04;
    ro.y += cos(uTime * 5.3) * uBass * 0.03;

    vec3 target = vec3(0.0);
    vec3 fwd = normalize(target - ro);
    vec3 right = normalize(cross(vec3(0, 1, 0), fwd));
    vec3 up = cross(fwd, right);
    vec3 rd = normalize(fwd + uv.x * right + uv.y * up);

    vec3 col = vec3(0.0);

    // Volumetric nebula pass
    col += nebulaGlow(ro, rd);

    // Surface hit
    float t = march(ro, rd);
    if (t > 0.0) {
        vec3 p = ro + rd * t;
        vec3 n = calcNormal(p);
        vec3 light = normalize(vec3(1.0, 1.0, -0.5));
        vec3 light2 = normalize(vec3(-0.5, -0.3, 1.0));

        float diff = max(dot(n, light), 0.0);
        float diff2 = max(dot(n, light2), 0.0);
        float fres = pow(1.0 - max(dot(n, -rd), 0.0), 3.5);
        float spec = pow(max(dot(reflect(rd, n), light), 0.0), 32.0);

        // Surface color reacts to audio
        float pulse = 0.5 + 0.5 * sin(uTime * 3.0 + length(p) * 6.0);
        vec3 inner = vec3(uThemeColor.z, uThemeColor.x, uThemeColor.y);
        vec3 surfCol = uThemeColor * (0.2 + diff * 0.4);
        surfCol += inner * diff2 * 0.15;
        // Fresnel rim — energy drives brightness
        surfCol += mix(uThemeColor, vec3(1.0), 0.5) * fres * (0.4 + uEnergy * 1.0);
        // Specular highlight
        surfCol += vec3(1.0) * spec * (0.3 + uHigh * 0.7);
        // Bass pulse glow on surface
        surfCol += uThemeColor * pulse * uBass * 0.5;

        col += surfCol;
    }

    // Bass-reactive bloom (reduced)
    float bloom = uBass * 0.06 + uEnergy * 0.02;
    col += uThemeColor * bloom * exp(-length(uv) * 1.5);

    // Tone map — pull down overall brightness
    col *= 0.4;
    col = col / (col + vec3(1.0));
    col = pow(col, vec3(0.85));

    // Only luminous values are visible — hard cutoff kills the halo
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    float alpha = smoothstep(0.02, 0.06, lum) * min(lum * 8.0, 1.0);
    // Kill any dark fringe
    col *= alpha;

    gl_FragColor = vec4(col, alpha);
}
`;

function initWebGL() {
    gl = canvas3d.getContext('webgl', { alpha: true, premultipliedAlpha: false, antialias: false });
    if (!gl) { console.error('[viz] WebGL not available'); return; }

    // Compile shaders
    function compile(type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error('[viz] Shader error:', gl.getShaderInfoLog(s));
            return null;
        }
        return s;
    }

    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;

    glProgram = gl.createProgram();
    gl.attachShader(glProgram, vs);
    gl.attachShader(glProgram, fs);
    gl.linkProgram(glProgram);
    if (!gl.getProgramParameter(glProgram, gl.LINK_STATUS)) {
        console.error('[viz] Program link error:', gl.getProgramInfoLog(glProgram));
        return;
    }
    gl.useProgram(glProgram);

    // Full-screen quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const posAttr = gl.getAttribLocation(glProgram, 'pos');
    gl.enableVertexAttribArray(posAttr);
    gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 0, 0);

    // Uniform locations
    uTime = gl.getUniformLocation(glProgram, 'uTime');
    uResolution = gl.getUniformLocation(glProgram, 'uResolution');
    uBass = gl.getUniformLocation(glProgram, 'uBass');
    uMid = gl.getUniformLocation(glProgram, 'uMid');
    uHigh = gl.getUniformLocation(glProgram, 'uHigh');
    uEnergy = gl.getUniformLocation(glProgram, 'uEnergy');
    uThemeColor = gl.getUniformLocation(glProgram, 'uThemeColor');

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    glStartTime = performance.now();
    glReady = true;
    draw3d();
}

function draw3d() {
    requestAnimationFrame(draw3d);
    if (!mode3d || !glReady) return;

    const w = canvas3d.width = canvas3d.offsetWidth * devicePixelRatio;
    const h = canvas3d.height = canvas3d.offsetHeight * devicePixelRatio;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Extract audio bands
    let bass = 0, mid = 0, high = 0, energy = 0;
    if (freqData) {
        const len = freqData.length;
        // Bass: first 10%, Mid: 10-40%, High: 40-80%
        const bEnd = Math.floor(len * 0.1);
        const mEnd = Math.floor(len * 0.4);
        const hEnd = Math.floor(len * 0.8);
        for (let i = 0; i < bEnd; i++) bass += freqData[i];
        for (let i = bEnd; i < mEnd; i++) mid += freqData[i];
        for (let i = mEnd; i < hEnd; i++) high += freqData[i];
        bass = bass / (bEnd * 255);
        mid = mid / ((mEnd - bEnd) * 255);
        high = high / ((hEnd - mEnd) * 255);
        for (let i = 0; i < len; i++) energy += freqData[i];
        energy = energy / (len * 255);
    }

    // Asymmetric smoothing: fast attack, slower release for punchy dynamics
    function slew(current, target, attack, release) {
        return current + (target - current) * (target > current ? attack : release);
    }
    sBass = slew(sBass, bass, 0.4, 0.18);
    sMid = slew(sMid, mid, 0.3, 0.14);
    sHigh = slew(sHigh, high, 0.45, 0.2);
    sEnergy = slew(sEnergy, energy, 0.35, 0.15);

    // Theme color → RGB
    const themeH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--theme-h')) || 210;
    const themeS = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--theme-s')) || '50%';
    const s = parseFloat(themeS) / 100;
    const l = 0.6;
    // HSL → RGB
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs((themeH / 60) % 2 - 1));
    const m = l - c / 2;
    let r = m, g = m, b = m;
    if (themeH < 60) { r += c; g += x; }
    else if (themeH < 120) { r += x; g += c; }
    else if (themeH < 180) { g += c; b += x; }
    else if (themeH < 240) { g += x; b += c; }
    else if (themeH < 300) { r += x; b += c; }
    else { r += c; b += x; }

    const t = (performance.now() - glStartTime) / 1000;
    gl.uniform1f(uTime, t);
    gl.uniform2f(uResolution, w, h);
    gl.uniform1f(uBass, sBass);
    gl.uniform1f(uMid, sMid);
    gl.uniform1f(uHigh, sHigh);
    gl.uniform1f(uEnergy, sEnergy);
    gl.uniform3f(uThemeColor, r, g, b);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// ── Close button ────────────────────────────────────────────
document.getElementById('btn-close').addEventListener('click', (e) => {
    e.stopPropagation();
    window.gel.closeWindow();
});

// ── Window drag ─────────────────────────────────────────────
initWindowDrag();

function initWindowDrag() {
    blobBody.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; // Left click only
        if (e.target.closest('button, canvas')) return;

        // Native Tauri drag
        if (window.gel._startNativeDrag) {
            window.gel._startNativeDrag();
            return;
        }

        // IPC-based drag (fallback)
        let dragging = true, startX = e.screenX, startY = e.screenY;
        blobBody.classList.add('dragging');

        const onMove = (e2) => {
            if (!dragging) return;
            window.gel.windowDrag(e2.screenX - startX, e2.screenY - startY);
            startX = e2.screenX; startY = e2.screenY;
        };
        const onUp = () => {
            dragging = false; blobBody.classList.remove('dragging');
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}
