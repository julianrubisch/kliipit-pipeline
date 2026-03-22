#version 330

// Vector field pixel sort — STATE PASS (writes to ping-pong buffer)
// Port of ciphrd's "Pixel sorting with vector field" (Shadertoy, MIT license)
// Uses texelFetch + gl_FragCoord for pixel-precise feedback (no UV drift).
// Audio reactivity stripped — pure algorithm for debugging.

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;  // original image
uniform sampler2D texture1;  // audio data (unused)
uniform sampler2D texture2;  // previous frame (sort state)
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

// ---------- helpers ----------

float gscale(vec3 c) {
    return (c.r + c.g + c.b) / 3.0;
}

float _frame() {
    return round(u_time * 25.0);
}

// ---------- Vector field A: horizontal bands ----------

vec4 vfieldA(vec2 uv, vec2 res, float fr) {
    vec2 iuv = floor(uv * res);
    float r = mod(iuv.y, 2.0) * 2.0 - 1.0;
    vec2 dir = vec2(1.0, 1.0) * r * (mod(fr, 2.0) * 2.0 - 1.0);
    float b = mod(floor(uv.y * 5.0), 2.0) * 2.0 - 1.0;
    dir *= vec2(b, 1.0);
    return vec4(dir, b * 0.5 + 0.5, 1.0);
}

// ---------- Vector field B: diagonal / quadrant ----------

vec4 vfieldB(vec2 uv, vec2 res, float fr) {
    vec2 uv05 = uv - 0.5;
    vec2 uva = abs(uv05);

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

vec4 vfieldC(vec2 uv, vec2 res, float fr) {
    vec2 iuv = floor(uv * res);
    float r = mod(iuv.y, 2.0) * 2.0 - 1.0;
    vec2 dir = vec2(1.0, 1.0) * r * (mod(fr, 2.0) * 2.0 - 1.0);
    dir *= round(uv.x) * 2.0 - 1.0;

    float bVal = round(uv.x);
    float m = step(1.0 / res.x, abs(uv.x - 0.5));

    return vec4(dir, bVal, m);
}

// ---------- Get vector field (matches original Buffer C) ----------

vec4 getVfield(vec2 uv, vec2 res, float fr, float time) {
    float t = mod(time, 15.0);

    vec4 vfield;
    if (t < 5.0) {
        vfield = vfieldA(uv, res, fr);
    } else if (t < 10.0) {
        vfield = vfieldB(uv, res, fr);
    } else {
        vfield = vfieldC(uv, res, fr);
    }

    float t2 = mod(time, 30.0);
    if (t2 > 15.0) {
        vfield.b = 1.0 - vfield.b;
    }

    return vfield;
}

// ---------- Main (matches original Buffer D) ----------

void main() {
    vec2 res = vec2(textureSize(texture2, 0));
    float fr = _frame();

    // Pixel-precise coordinates (gl_FragCoord is in render target space)
    ivec2 icoord = ivec2(gl_FragCoord.xy);
    vec2 uv = gl_FragCoord.xy / res;

    float threshold = 0.04;

    // Vector field for this pixel
    vec4 vfield = getVfield(uv, res, fr, u_time);

    // Neighbor pixel (integer offset — always exactly ±1)
    ivec2 offset = ivec2(vfield.xy);
    ivec2 neighbor = icoord + offset;

    // Boundary check vertical
    if (neighbor.y < 0 || neighbor.y >= int(res.y)) {
        finalColor = texelFetch(texture2, icoord, 0);
        return;
    }

    // Wrap horizontally
    if (neighbor.x < 0) neighbor.x += int(res.x);
    if (neighbor.x >= int(res.x)) neighbor.x -= int(res.x);

    // Read exact pixels from previous sort state (no interpolation, no UV drift)
    vec4 actv = texelFetch(texture2, icoord, 0);
    vec4 comp = texelFetch(texture2, neighbor, 0);

    // Vector field at neighbor position (matches original: texture(iChannel2, uv + dr))
    vec2 neighbor_uv = (vec2(neighbor) + 0.5) / res;
    vec4 vfieldComp = getVfield(neighbor_uv, res, fr, u_time);

    if (vfield.a < 0.5 || vfieldComp.a < 0.5) {
        finalColor = actv;
        return;
    }

    // Compare and swap
    vec4 color = actv;
    float gAct = gscale(actv.rgb);
    float gCom = gscale(comp.rgb);

    // dr in UV space for classed computation (sign only, so precision doesn't matter)
    vec2 dr = vfield.xy / res;
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

    finalColor = vec4(color.rgb, 1.0);
}
