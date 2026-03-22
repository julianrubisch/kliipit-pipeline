#version 330

// Rutt-Etra — Audio-reactive horizontal scanline displacement effect
// Inspired by the Rutt-Etra video synthesizer: horizontal scan lines
// are vertically displaced by image brightness, creating a 3D wireframe look.

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;  // source image
uniform sampler2D texture1;  // audio data
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

#include "audio_common.glsl"

// --- Tuneable base parameters (modulated by audio) ---
const float BASE_LINE_NUM    = 0.15;   // scanline density
const float BASE_BRIGHTNESS  = 4.0;    // line brightness exponent
const float BASE_ANIMATION   = 0.008;  // scroll speed
const float BASE_DEPTH       = 70.0;   // parallax depth
const float BASE_INTENSITY   = 1.4;    // color intensity
const float BASE_LINE_WIDTH  = 1.2;    // line thickness
const int   SAMPLES          = 7;      // anti-aliasing samples for line detection

float luminance(vec3 c) {
    return dot(c, vec3(0.299, 0.587, 0.114));
}

void main() {
    vec2 uv = fragTexCoord;
    vec2 res = vec2(textureSize(texture0, 0));
    vec2 pixelSize = 1.0 / res;

    // --- Audio reactivity ---
    float loud   = getLoudness();
    float bass   = getBass();
    float mids   = getMids();
    float treble = getTreble();

    // Modulate parameters with audio
    float lineNum    = BASE_LINE_NUM * (1.0 - bass * 0.6);           // fewer lines on bass = wider gaps, deeper feel
    float brightness = BASE_BRIGHTNESS * (1.0 + loud * 2.0);        // brighter on loud
    float animation  = BASE_ANIMATION * (1.0 + mids * 4.0);         // faster scroll on mids
    float depth      = BASE_DEPTH * (1.0 + bass * 0.8);             // deeper parallax on bass
    float intensity  = BASE_INTENSITY * (1.0 + treble * 1.0);       // more vivid on treble
    float lineWidth  = BASE_LINE_WIDTH * (1.0 + mids * 1.5);        // thicker lines on mids

    // --- Vertical accumulation (inline replacement for Buffer A) ---
    // Accumulate luminance from top of image down to current row.
    // Use stepped sampling to keep it tractable (not per-pixel).
    float accum = 0.1;
    int stepCount = max(1, int(uv.y * res.y / 4.0));  // sample every ~4 pixels
    float stepSize = uv.y / float(stepCount);
    for (int i = 0; i < stepCount && i < 256; i++) {
        float sampleY = float(i) * stepSize;
        float g = texture(texture0, vec2(uv.x, sampleY)).g;
        accum += g * stepSize;
    }

    // Original pixel luminance for coloring
    vec3 origColor = texture(texture0, uv).rgb;
    float img = luminance(origColor);

    // --- Parallax / depth effect (simplified Buffer B) ---
    vec2 pixel = (uv - 0.5) + vec2(0.0, 0.1);
    vec3 depthCol = origColor;
    for (int i = 1; i < 40; i++) {
        float d = 50.0 + float(i);
        vec2 depthUV = pixel * d / depth;
        depthUV = fract(depthUV + vec2(0.5, 0.4));
        vec3 samp = texture(texture0, depthUV).rgb;
        float sampLum = luminance(samp);
        if ((1.0 - sampLum * sampLum) < float(i + 1) / 20.0) {
            depthCol = samp;
            break;
        }
    }
    depthCol = min(depthCol * depthCol * intensity, vec3(1.0));

    // Blend depth coloring with original based on bass (subtle parallax)
    float depthMix = 0.15 + bass * 0.35;
    vec3 colorBase = mix(origColor, depthCol, depthMix);
    float colorLum = luminance(colorBase);

    // --- Scanline rendering (Image pass) ---
    // Detect scan lines by checking if the accumulated value crosses
    // a line boundary within the local neighborhood.
    float halfSamples = float(SAMPLES / 2);
    float lines[7];  // must match SAMPLES

    for (int i = 0; i < SAMPLES; i++) {
        float offset = float(i) - halfSamples;
        vec2 sampleUV = uv + vec2(0.0, offset * pixelSize.y);
        sampleUV = clamp(sampleUV, vec2(0.0), vec2(1.0));

        // Recompute accumulation at offset (approximation: use local gradient)
        float localAccum = accum + offset * pixelSize.y * texture(texture0, sampleUV).g;
        localAccum += fract(animation * u_time);

        lines[i] = floor(localAccum * lineNum * res.y);
    }

    // Detect line edges: where the quantized line index changes between samples
    float br = 0.0;
    for (int i = 0; i < SAMPLES - 1; i++) {
        if (lines[i + 1] - lines[i] > 0.1) {
            float s = float(i) - halfSamples;
            br += max(0.0, 1.0 - abs(s / (lineWidth + img)));
        }
    }

    // Final color: scanline brightness applied to the depth-colored image.
    // As loudness increases, the dark gaps between scan lines fill in with
    // the underlying image, making it increasingly perceivable.
    float lineBr = pow(clamp(br, 0.0, 1.0), 1.0 / brightness);

    // Floor level: silent = pure black between lines, loud = image bleeds through
    float floorLevel = loud * loud * 0.6;  // squared for natural ramp
    vec3 floorColor = origColor * floorLevel;

    vec3 color = mix(floorColor, colorBase, lineBr);

    // --- Audio-reactive post-processing ---

    // Glow boost on loud passages
    color += color * loud * 0.3;

    // Subtle color tinting: warm on bass, cool on treble
    color.r *= 1.0 + bass * 0.2;
    color.b *= 1.0 + treble * 0.2;

    // Vignette
    float vign = 1.0 - 0.4 * pow(length(uv - 0.5) * 1.4, 2.0);
    color *= vign;

    finalColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
