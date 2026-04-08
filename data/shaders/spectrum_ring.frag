#version 330
// Spectrum Ring — rotating radar-sweep spectrum line with feedback trails
// Bars placed along a tilted ellipse (circle viewed from above), always
// growing straight up. Temporal feedback creates spiral trail patterns.
// Inspired by programmverdichter TouchDesigner aesthetics.

in vec2 fragTexCoord;
in vec4 fragColor;

uniform sampler2D texture0;
uniform sampler2D texture1;
uniform sampler2D texture2;   // previous frame (ping-pong feedback)
uniform float u_time;
uniform float u_duration;

out vec4 finalColor;

#include "audio_common.glsl"

const int   NUM_BARS = 24;
const float DECAY = 0.93;
const float RADIUS = 0.35;         // screen-space ellipse semi-major axis
const float TILT = 0.5;            // vertical foreshortening (cos ~30 degrees)
const float BAR_GAP_FRAC = 0.15;
const vec3 BAR_COLOR = vec3(0.8, 0.9, 0.2);

const float FREQ_MIN = 20.0;
const float FREQ_MAX = 20000.0;
const float SAMPLE_RATE = 44100.0;

float hzToMel(float hz) { return 2595.0 * log(1.0 + hz / 700.0) / log(10.0); }
float melToHz(float mel) { return 700.0 * (pow(10.0, mel / 2595.0) - 1.0); }
float hzToSpecY(float hz) { return 1.0 - clamp(hz / (SAMPLE_RATE * 0.5), 0.0, 1.0); }

float getMelMagnitude(int barIndex, float tx) {
    float melLow  = hzToMel(FREQ_MIN);
    float melHigh = hzToMel(FREQ_MAX);
    float melStart = melLow + (melHigh - melLow) * float(barIndex) / float(NUM_BARS);
    float melEnd   = melLow + (melHigh - melLow) * float(barIndex + 1) / float(NUM_BARS);
    float specYStart = hzToSpecY(melToHz(melStart));
    float specYEnd   = hzToSpecY(melToHz(melEnd));
    float mag = 0.0;
    for (int s = 0; s < 4; s++) {
        float t = float(s) / 4.0;
        mag += texture(texture1, vec2(tx, mix(specYEnd, specYStart, t))).r;
    }
    return mag / 4.0;
}

void main() {
    vec2 res = vec2(textureSize(texture0, 0));
    float aspect = res.x / res.y;
    vec2 uv = fragTexCoord;
    vec2 screen = (uv - 0.5) * vec2(aspect, 1.0);

    float bass = getBass();
    float loud = getLoudness();
    float tx = clamp(u_time / u_duration, 0.0, 1.0);

    // Feedback
    vec3 prev = texture(texture2, uv).rgb;
    float prevBright = dot(prev, vec3(0.333));
    prev *= prevBright > 0.3 ? 0.0 : DECAY;

    // Rotation: steady + loudness wobble
    float rotation = u_time * 0.8 + sin(u_time * 1.5) * loud * 0.4;

    vec3 newBars = vec3(0.0);

    // Draw bars along a diameter of the tilted ellipse
    for (int i = -NUM_BARS; i < NUM_BARS; i++) {
        int freqIdx = abs(i);
        if (freqIdx >= NUM_BARS) continue;
        float mag = getMelMagnitude(freqIdx, tx);

        // Position along the sweep line: -1 to +1
        float t = (float(i) + 0.5) / float(NUM_BARS);

        // Place on tilted ellipse (circle viewed from above)
        float angle = rotation;
        float x = t * RADIUS * cos(angle);
        float y = t * RADIUS * sin(angle) * TILT;

        // Pseudo-depth: bars at "back" (negative sin) are smaller/dimmer
        float depth = 0.7 + 0.3 * sin(angle + 3.14159) * t;

        // Bar dimensions
        float slotWidth = RADIUS / float(NUM_BARS);
        float barWidth = slotWidth * (1.0 - BAR_GAP_FRAC) * depth;
        float barHeight = (mag * 0.15 + 0.003) * depth;

        // Bar rectangle: centered at (x, y), width along sweep direction, height straight up
        vec2 barCenter = vec2(x, y);
        vec2 toPixel = screen - barCenter;

        // Along-line direction on the ellipse
        vec2 lineDir = normalize(vec2(cos(angle), sin(angle) * TILT));

        float alongLine = abs(dot(toPixel, lineDir));
        float upward = -toPixel.y;  // bars grow upward (screen Y is inverted)

        if (alongLine < barWidth * 0.5 && upward > 0.0 && upward < barHeight) {
            float brightness = mag * (0.5 + loud * 1.5) * depth;
            float edgeAA = smoothstep(barWidth * 0.5, barWidth * 0.2, alongLine)
                         * smoothstep(barHeight, barHeight * 0.7, upward);
            newBars += BAR_COLOR * brightness * edgeAA;
        }
    }

    finalColor = vec4(prev + newBars, 1.0);
}
