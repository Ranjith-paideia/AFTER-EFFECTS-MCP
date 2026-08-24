/**
 * A comprehensive catalog of parameterized After Effects expression generators.
 * Each function returns a string of valid After Effects expression code
 * (ES3-compatible JavaScript that runs inside AE's expression engine).
 */
/**
 * Velocity-based overshoot bounce.
 * Uses velocityAtTime() to create spring-like overshoot after the last keyframe.
 * @param params {InertiaParams} Parameters for inertia
 * @returns {string} AE expression string
 */
export function inertia(params = {}) {
    const amp = params.amp ?? 0.06;
    const freq = params.freq ?? 3.0;
    const decay = params.decay ?? 6.0;
    return `var n = 0;
if (numKeys > 0) {
  n = nearestKey(time).index;
  if (key(n).time > time) n--;
}
if (n == 0) { value; } else {
  var t = time - key(n).time;
  if (t < 0) { value; } else {
    var v = velocityAtTime(key(n).time - thisComp.frameDuration/10);
    var amp = ${amp}; var freq = ${freq}; var decay = ${decay};
    value + v * amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t);
  }
}`;
}
/**
 * Parameterized wiggle.
 * @param params {WiggleParams} Parameters for wiggle
 * @returns {string} AE expression string
 */
export function wiggle(params = {}) {
    const freq = params.freq ?? 3;
    const amp = params.amp ?? 50;
    const octaves = params.octaves ?? 1;
    const ampMult = params.ampMult ?? 0.5;
    const t = params.t ?? 'time';
    return `wiggle(${freq}, ${amp}, ${octaves}, ${ampMult}, ${t})`;
}
/**
 * Damped harmonic oscillator.
 * Similar to inertia but uses Math.cos and works from the difference between current and previous keyframe values.
 * @param params {ElasticSpringParams} Parameters for elastic spring
 * @returns {string} AE expression string
 */
export function elasticSpring(params = {}) {
    const amp = params.amp ?? 0.1;
    const freq = params.freq ?? 4.0;
    const decay = params.decay ?? 5.0;
    return `var n = 0;
if (numKeys > 0) {
  n = nearestKey(time).index;
  if (key(n).time > time) n--;
}
if (n < 2) { value; } else {
  var t = time - key(n).time;
  if (t < 0) { value; } else {
    var delta = value - valueAtTime(key(n-1).time);
    var amp = ${amp}; var freq = ${freq}; var decay = ${decay};
    value + delta * amp * Math.cos(freq * t * 2 * Math.PI) / Math.exp(decay * t);
  }
}`;
}
/**
 * Index-offset stagger using previous layer.
 * @param params {StaggerDelayParams} Parameters for stagger delay
 * @returns {string} AE expression string
 */
export function staggerDelay(params = {}) {
    const delayFrames = params.delayFrames ?? 3;
    const property = params.property ?? 'transform.position';
    return `var delay = thisComp.frameDuration * ${delayFrames};
try {
  thisComp.layer(index - 1).${property}.valueAtTime(time - delay);
} catch(e) {
  value;
}`;
}
/**
 * Path-following auto-orient with banking.
 * @param params {AutoOrientParams} Parameters for auto orient
 * @returns {string} AE expression string
 */
export function autoOrient(params = {}) {
    const bankAngle = params.bankAngle ?? 0;
    return `var v = position.velocityAtTime(time);
var angle = Math.atan2(v[1], v[0]) * 180 / Math.PI;
angle + ${bankAngle};`;
}
/**
 * Linear remap from audio amplitude.
 * @param params {AudioLinkParams} Parameters for audio link
 * @returns {string} AE expression string
 */
export function audioLink(params = {}) {
    const minVal = params.minVal ?? 0;
    const maxVal = params.maxVal ?? 100;
    const audioLayerIndex = params.audioLayerIndex ?? 1;
    const channel = params.channel ?? 'both';
    let channelName = "Both Channels";
    if (channel === 'left')
        channelName = "Left Channel";
    else if (channel === 'right')
        channelName = "Right Channel";
    return `var audioLayer = thisComp.layer(${audioLayerIndex});
var audioVal = audioLayer.effect("${channelName}")("Slider").value;
linear(audioVal, 0, 30, ${minVal}, ${maxVal});`;
}
/**
 * sourceRectAtTime() bounding box for auto-sizing backplates (size).
 * @param params {AutoResizeBoxParams} Parameters for auto resize box size
 * @returns {string} AE expression string
 */
export function autoResizeBox(params = {}) {
    const padding = params.padding ?? [20, 10];
    const targetLayerIndexStr = params.targetLayerIndex !== undefined ? params.targetLayerIndex.toString() : "index + 1";
    return `var textLayer = thisComp.layer(${targetLayerIndexStr});
var rect = textLayer.sourceRectAtTime(time, false);
[rect.width + ${padding[0]} * 2, rect.height + ${padding[1]} * 2];`;
}
/**
 * sourceRectAtTime() bounding box for auto-sizing backplates (position).
 * @param params {AutoResizeBoxParams} Parameters for auto resize box position
 * @returns {string} AE expression string
 */
export function autoResizeBoxPosition(params = {}) {
    const targetLayerIndexStr = params.targetLayerIndex !== undefined ? params.targetLayerIndex.toString() : "index + 1";
    return `var textLayer = thisComp.layer(${targetLayerIndexStr});
var rect = textLayer.sourceRectAtTime(time, false);
[rect.left + rect.width / 2, rect.top + rect.height / 2];`;
}
/**
 * Keyframe loop expressions.
 * @param params {LoopCycleParams} Parameters for loop cycle
 * @returns {string} AE expression string
 */
export function loopCycle(params = {}) {
    const type = params.type ?? 'cycle';
    const inOrOut = params.inOrOut ?? 'out';
    if (inOrOut === 'in') {
        return `loopIn("${type}")`;
    }
    else if (inOrOut === 'both') {
        return `var t = time;
var inDur = key(1).time;
var outDur = key(numKeys).time;
if (t < inDur) { loopIn("${type}"); } else if (t > outDur) { loopOut("${type}"); } else { value; }`;
    }
    else {
        return `loopOut("${type}")`;
    }
}
/**
 * Simple time remap expression.
 * @param params {TimeRemapParams} Parameters for time remap
 * @returns {string} AE expression string
 */
export function timeRemap(params = {}) {
    const speedFactor = params.speedFactor ?? 1;
    return `time * ${speedFactor}`;
}
/**
 * Random value expression.
 * @param params {RandomParams} Parameters for random expression
 * @returns {string} AE expression string
 */
export function random(params = {}) {
    const min = params.min ?? 0;
    const max = params.max ?? 100;
    const seed = params.seed ?? false;
    if (seed) {
        return `seedRandom(index, true); random(${min}, ${max});`;
    }
    else {
        return `random(${min}, ${max})`;
    }
}
/**
 * Returns the list of all available expression names
 * @returns {string[]} Array of expression names
 */
export function getAllExpressionNames() {
    return [
        'inertia',
        'wiggle',
        'elasticSpring',
        'staggerDelay',
        'autoOrient',
        'audioLink',
        'autoResizeBox',
        'autoResizeBoxPosition',
        'loopCycle',
        'timeRemap',
        'random'
    ];
}
//# sourceMappingURL=expressions.js.map