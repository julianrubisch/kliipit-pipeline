#version 330

// Vector field pixel sort — STATE PASS (writes to ping-pong buffer)
// Port of ciphrd's "Pixel sorting with vector field" (Shadertoy, MIT license)
// Collapses Buffers A/B/C/D into a single pass with audio reactivity.
// Pure structural sort: no color/brightness effects.

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;  // original image
uniform sampler2D texture1;  // audio data
uniform sampler2D texture2;  // previous frame (sort state)
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

#include "audio_common.glsl"

// ---------- helpers ----------

float gscale(vec3 c) {
    return (c.r + c.g + c.b) / 3.0;
}

// Derive a frame counter (25 fps assumed)
float _frame() {
    return floor(u_time * 25.0);
}

// ---------- Vector field A: horizontal bands ----------
// Alternating sort direction per pixel row and per frame.

vec4 vfieldA(vec2 uv, vec2 res) {
    float fr = _frame();
    vec2 iuv = floor(uv * res);
    float r = mod(iuv.y, 2.0) * 2.0 - 1.0;
    vec2 dir = vec2(1.0, 1.0) * r * (mod(fr, 2.0) * 2.0 - 1.0);
    float b = mod(floor(uv.y * 5.0), 2.0) * 2.0 - 1.0;
    dir *= vec2(b, 1.0);
    return vec4(dir, b * 0.5 + 0.5, 1.0);
}

// ---------- Vector field B: diagonal / quadrant ----------

vec4 vfieldB(vec2 uv, vec2 res) {
    float fr = _frame();
    vec2 uv05 = uv - 0.5;
    vec2 uva = abs(uv05);
    vec2 uvf = mod(floor(uva * res) + fr, 2.0);

    vec2 topright    = vec2(1.0,  1.0);
    vec2 bottomright = vec2(1.0, -1.0);

    float dQuad = sign(uv05.x) * sign(uv05.y) * 0.5 + 0.5;
    vec2 dir = mix(topright, bottomright, dQuad);
    dir *= sign(uv05.y);
    dir *= mod(floor(uv.y * res.y) + fr, 2.0) * 2.0 - 1.0;

    float bVal = uv05.y < 0.0 ? 1.0 : 0.0;
    bVal += round(uva.x + uva.y);
    if (bVal > 1.5) bVal = 0.0;
    bVal = 1.0 - bVal;

    float isTopLeft = (uv05.x > 0.0 && uv05.y > 0.0) ? 1.0 : 0.0;
    float nosort = isTopLeft * (uv05.y * res.y > 1.0 ? 0.0 : 1.0);

    return vec4(dir, bVal, 1.0 - nosort);
}

// ---------- Vector field C: vertical split ----------

vec4 vfieldC(vec2 uv, vec2 res) {
    float fr = _frame();
    vec2 iuv = floor(uv * res);
    float r = mod(iuv.y, 2.0) * 2.0 - 1.0;
    vec2 dir = vec2(1.0, 1.0) * r * (mod(fr, 2.0) * 2.0 - 1.0);
    dir *= round(uv.x) * 2.0 - 1.0;

    float bVal = round(uv.x);
    float m = step(1.0 / res.x, abs(uv.x - 0.5));

    return vec4(dir, bVal, m);
}

// ---------- Main ----------

void main() {
    vec2 uv = fragTexCoord;
    vec2 res = vec2(textureSize(texture2, 0));
    vec2 pixelSize = 1.0 / res;

    // Audio
    float bass   = getBass();
    float mids   = getMids();
    float treble = getTreble();
    float loud   = getLoudness();

    // --- Seed phase: first ~30 frames, just pass through original ---
    float fr = _frame();
    if (fr < 30.0) {
        finalColor = texture(texture0, uv);
        return;
    }

    // --- Select vector field (audio-reactive cycling) ---
    // Base cycle period shortened by mids energy
    float cyclePeriod = mix(12.0, 3.0, clamp(mids * 4.0, 0.0, 1.0));
    // Mids bias: high mids energy shifts toward more complex patterns (B/C)
    float midsBias = mids * cyclePeriod * 0.5;
    float t = mod(u_time + midsBias, cyclePeriod * 3.0);

    vec4 vfield;
    if (t < cyclePeriod) {
        vfield = vfieldA(uv, res);
    } else if (t < cyclePeriod * 2.0) {
        vfield = vfieldB(uv, res);
    } else {
        vfield = vfieldC(uv, res);
    }

    // --- Treble drives direction flipping ---
    float flipPeriod = mix(25.0, 4.0, clamp(treble * 6.0, 0.0, 1.0));
    float t2 = mod(u_time, flipPeriod * 2.0);
    if (t2 > flipPeriod) {
        vfield.b = 1.0 - vfield.b;
    }

    // --- Bass modulates sort intensity via threshold ---
    // Lower threshold = more pixels participate in sorting
    float threshold = mix(0.12, 0.001, clamp(bass * 5.0, 0.0, 1.0));

    // --- Sorting engine (Buffer D logic) ---
    vec2 dr = vfield.xy / res;
    vec2 p = uv + dr;

    // Wrap horizontally
    if (p.x < 0.0) p.x = 1.0 - p.x;
    if (p.x > 1.0) p.x = fract(p.x);

    // Read from previous sort state (self-feedback)
    vec4 actv = texture(texture2, uv);
    vec4 comp = texture(texture2, p);

    // Boundary check vertical
    if (uv.y + dr.y < 0.0 || uv.y + dr.y > 1.0) {
        finalColor = actv;
        return;
    }

    // Check alpha (sort-enabled flag) for both pixels
    float tBiased = mod(u_time + midsBias, cyclePeriod * 3.0);
    vec4 vfieldComp = (tBiased < cyclePeriod)
        ? vfieldA(p, res)
        : (tBiased < cyclePeriod * 2.0)
            ? vfieldB(p, res)
            : vfieldC(p, res);

    if (vfield.a < 0.5 || vfieldComp.a < 0.5) {
        finalColor = actv;
        return;
    }

    // Compare and swap
    vec4 color = actv;
    float gAct = gscale(actv.rgb);
    float gCom = gscale(comp.rgb);
    float classed = sign(dr.x * 2.0 + dr.y);

    if (classed < 0.0) {
        if (vfield.b > 0.5) {
            if (gCom > threshold && gAct > gCom) color = comp;
        } else {
            if (gAct > threshold && gAct < gCom) color = comp;
        }
    } else {
        if (vfield.b > 0.5) {
            if (gAct > threshold && gAct < gCom) color = comp;
        } else {
            if (gCom > threshold && gAct > gCom) color = comp;
        }
    }

    // --- Gentle decay toward original when quiet (prevents permanent lock) ---
    // Loudness (32-bin average) is a more accurate overall volume signal than sum of bands
    float decayRate = mix(0.05, 0.0, clamp(loud * 5.0, 0.0, 1.0));
    vec3 original = texture(texture0, uv).rgb;
    color.rgb = mix(color.rgb, original, decayRate);

    // Output clean state
    finalColor = vec4(color.rgb, 1.0);
}
