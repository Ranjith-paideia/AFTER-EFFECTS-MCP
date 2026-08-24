/**
 * A comprehensive catalog of parameterized After Effects expression generators.
 * Each function returns a string of valid After Effects expression code
 * (ES3-compatible JavaScript that runs inside AE's expression engine).
 */
export interface InertiaParams {
    amp?: number;
    freq?: number;
    decay?: number;
}
/**
 * Velocity-based overshoot bounce.
 * Uses velocityAtTime() to create spring-like overshoot after the last keyframe.
 * @param params {InertiaParams} Parameters for inertia
 * @returns {string} AE expression string
 */
export declare function inertia(params?: InertiaParams): string;
export interface WiggleParams {
    freq?: number;
    amp?: number;
    octaves?: number;
    ampMult?: number;
    t?: string;
}
/**
 * Parameterized wiggle.
 * @param params {WiggleParams} Parameters for wiggle
 * @returns {string} AE expression string
 */
export declare function wiggle(params?: WiggleParams): string;
export interface ElasticSpringParams {
    amp?: number;
    freq?: number;
    decay?: number;
}
/**
 * Damped harmonic oscillator.
 * Similar to inertia but uses Math.cos and works from the difference between current and previous keyframe values.
 * @param params {ElasticSpringParams} Parameters for elastic spring
 * @returns {string} AE expression string
 */
export declare function elasticSpring(params?: ElasticSpringParams): string;
export interface StaggerDelayParams {
    delayFrames?: number;
    property?: string;
}
/**
 * Index-offset stagger using previous layer.
 * @param params {StaggerDelayParams} Parameters for stagger delay
 * @returns {string} AE expression string
 */
export declare function staggerDelay(params?: StaggerDelayParams): string;
export interface AutoOrientParams {
    bankAngle?: number;
}
/**
 * Path-following auto-orient with banking.
 * @param params {AutoOrientParams} Parameters for auto orient
 * @returns {string} AE expression string
 */
export declare function autoOrient(params?: AutoOrientParams): string;
export interface AudioLinkParams {
    minVal?: number;
    maxVal?: number;
    audioLayerIndex?: number;
    channel?: 'left' | 'right' | 'both';
}
/**
 * Linear remap from audio amplitude.
 * @param params {AudioLinkParams} Parameters for audio link
 * @returns {string} AE expression string
 */
export declare function audioLink(params?: AudioLinkParams): string;
export interface AutoResizeBoxParams {
    padding?: [number, number];
    targetLayerIndex?: number;
}
/**
 * sourceRectAtTime() bounding box for auto-sizing backplates (size).
 * @param params {AutoResizeBoxParams} Parameters for auto resize box size
 * @returns {string} AE expression string
 */
export declare function autoResizeBox(params?: AutoResizeBoxParams): string;
/**
 * sourceRectAtTime() bounding box for auto-sizing backplates (position).
 * @param params {AutoResizeBoxParams} Parameters for auto resize box position
 * @returns {string} AE expression string
 */
export declare function autoResizeBoxPosition(params?: AutoResizeBoxParams): string;
export interface LoopCycleParams {
    type?: 'cycle' | 'pingpong' | 'offset' | 'continue';
    inOrOut?: 'out' | 'in' | 'both';
}
/**
 * Keyframe loop expressions.
 * @param params {LoopCycleParams} Parameters for loop cycle
 * @returns {string} AE expression string
 */
export declare function loopCycle(params?: LoopCycleParams): string;
export interface TimeRemapParams {
    speedFactor?: number;
}
/**
 * Simple time remap expression.
 * @param params {TimeRemapParams} Parameters for time remap
 * @returns {string} AE expression string
 */
export declare function timeRemap(params?: TimeRemapParams): string;
export interface RandomParams {
    min?: number;
    max?: number;
    seed?: boolean;
}
/**
 * Random value expression.
 * @param params {RandomParams} Parameters for random expression
 * @returns {string} AE expression string
 */
export declare function random(params?: RandomParams): string;
/**
 * Returns the list of all available expression names
 * @returns {string[]} Array of expression names
 */
export declare function getAllExpressionNames(): string[];
//# sourceMappingURL=expressions.d.ts.map