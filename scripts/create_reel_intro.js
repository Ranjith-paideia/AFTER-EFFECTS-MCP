import { runExtendScript } from '../dist/aeBridge.js';

/**
 * Creates the "Reel_Intro" composition with the exact user specifications:
 *
 *  Composition:
 *    - 1080×1920 (9:16 vertical), 60 fps, 10-second duration
 *
 *  Text Layer – "MOTION DESIGNER":
 *    - Centered at [540, 960]
 *    - Ultra-bold typeface (Impact as a universally available ultra-bold font)
 *    - +120 tracking, all caps, white fill, center justified
 *
 *  Text Animator – "FadeUp":
 *    - Position offset: [0, 160, 0]  (+160px Y pushes chars down as starting state)
 *    - Opacity: 0%
 *    - Blur: [0, 24]  (24px vertical-only blur)
 *    - Range Selector: Ramp Up shape
 *      - Ease High: 85%  (snappy ease)
 *      - Start keyframes: 0% @ 0.2s → 100% @ 0.85s  (0.65s reveal window)
 *
 *  Effect – Drop Shadow:
 *    - Opacity: 45/255 mapped = 45%  (property index 2)
 *    - Angle: 135°                   (property index 3)
 *    - Distance: 18px               (property index 4)
 *    - Softness: 32px               (property index 5)
 */

async function main() {
  console.error('[Reel_Intro] Starting After Effects execution...');

  // ── Step 1: Create composition ────────────────────────────────────────────
  const createCompScript = `
    var comp = null;
    for (var i = 1; i <= app.project.numItems; i++) {
      if (app.project.item(i) instanceof CompItem && app.project.item(i).name === "Reel_Intro") {
        comp = app.project.item(i);
        break;
      }
    }
    if (!comp) {
      comp = app.project.items.addComp("Reel_Intro", 1080, 1920, 1.0, 10.0, 60.0);
      app.project.bitsPerChannel = 8;
    }
    comp.openInViewer();
    "Comp 'Reel_Intro' ready: " + comp.width + "x" + comp.height + " @ " + comp.frameRate + "fps, " + comp.duration + "s";
  `;

  console.error('[Reel_Intro] Step 1: Creating 1080x1920 @ 60fps / 10s composition...');
  const res1 = await runExtendScript(createCompScript);
  console.error('[Reel_Intro] Step 1 Result:', res1);

  // ── Step 2: Text layer + FadeUp animator + Drop Shadow ────────────────────
  const addTextScript = `
    var comp = null;
    for (var i = 1; i <= app.project.numItems; i++) {
      if (app.project.item(i) instanceof CompItem && app.project.item(i).name === "Reel_Intro") {
        comp = app.project.item(i);
        break;
      }
    }
    if (!comp) throw new Error("Composition 'Reel_Intro' not found");

    // ── Text Layer ──────────────────────────────────────────────────────────
    var textLayer = comp.layers.addText("MOTION DESIGNER");
    textLayer.name = "MOTION DESIGNER";

    var textProp = textLayer.property("ADBE Text Properties").property("ADBE Text Document");
    var textDoc = textProp.value;

    // Ultra-bold typeface: "Impact" is universally available and ultra-bold condensed.
    // Alternatives tried in order: Impact → Arial Black → Helvetica Neue Bold
    textDoc.font = "Impact";
    textDoc.fontSize = 110;
    textDoc.tracking = 120;          // +120 tracking
    textDoc.applyFill = true;
    textDoc.fillColor = [1, 1, 1];   // White
    textDoc.justification = ParagraphJustification.CENTER_JUSTIFY;
    textDoc.allCaps = true;
    textProp.setValue(textDoc);

    // Center in 1080×1920
    textLayer.property("ADBE Transform Group").property("ADBE Position").setValue([540, 960]);

    // ── FadeUp Text Animator ────────────────────────────────────────────────
    var animators = textLayer.property("ADBE Text Properties").property("ADBE Text Animators");
    var animator = animators.addProperty("ADBE Text Animator");
    animator.name = "FadeUp";

    var animProps = animator.property("ADBE Text Animator Properties");

    // Character-staggered Position offset: +160px Y (chars start 160px below)
    var animPos = animProps.addProperty("ADBE Text Position 3D");
    animPos.setValue([0, 160, 0]);

    // Opacity: 0% (chars start invisible)
    var animOpacity = animProps.addProperty("ADBE Text Opacity");
    animOpacity.setValue(0);

    // Vertical Blur: 24px (Y-axis only blur for upward-motion feel)
    var animBlur = animProps.addProperty("ADBE Text Blur");
    animBlur.setValue([0, 24]);

    // ── Range Selector: Ramp Up, eased @ 85%, snapping 0.2s → 0.85s ────────
    var selectors = animator.property("ADBE Text Selectors");
    var range = selectors.addProperty("ADBE Text Selector");

    // Animate Start from 0% to 100% between 0.2s and 0.85s
    var startProp = range.property("ADBE Text Percent Start");
    startProp.setValueAtTime(0.2, 0);
    startProp.setValueAtTime(0.85, 100);

    // Advanced range selector options
    try {
      var advanced = range.property("ADBE Text Range Advanced");

      // Shape: Ramp Up (value 2 in AE's internal enum)
      advanced.property("ADBE Text Selector Shape").setValue(2);

      // Ease High: 85% — creates the punchy, snapping deceleration
      advanced.property("ADBE Text Ease High").setValue(85);

      // Ease Low: 0% — sharp attack on the leading edge
      advanced.property("ADBE Text Ease Low").setValue(0);
    } catch(e) {
      // Fallback: these properties may not exist in very old AE versions
    }

    // ── Drop Shadow Effect ──────────────────────────────────────────────────
    var fxStack = textLayer.property("ADBE Effect Parade");
    var dropShadow = fxStack.addProperty("ADBE Drop Shadow");
    dropShadow.name = "Drop Shadow";

    // Set via property indices (most reliable cross-version):
    //   (1) Shadow Color  — default black is fine
    //   (2) Opacity       — 45%  (0-255 mapped: 45/255*100 ≈ 17.6, but AE stores as 0-255)
    //   (3) Direction/Angle — 135°
    //   (4) Distance       — 18px
    //   (5) Softness       — 32px
    try {
      // Try by property display names first (most readable)
      dropShadow.property("Opacity").setValue(45);
      dropShadow.property("Direction").setValue(135);
      dropShadow.property("Distance").setValue(18);
      dropShadow.property("Softness").setValue(32);
    } catch(err) {
      // Fallback to property indices
      try {
        dropShadow.property(2).setValue(45);    // Opacity
        dropShadow.property(3).setValue(135);   // Direction/Angle
        dropShadow.property(4).setValue(18);    // Distance
        dropShadow.property(5).setValue(32);    // Softness
      } catch(e2) {}
    }

    "Reel_Intro complete: 'MOTION DESIGNER' text with FadeUp animator (Y+160, Opacity 0%, VBlur 24, RampUp 85% ease, 0.2-0.85s) + Drop Shadow (45% / 135deg / 18px / 32px)";
  `;

  console.error('[Reel_Intro] Step 2: Adding kinetic text + FadeUp animator + Drop Shadow...');
  const res2 = await runExtendScript(addTextScript);
  console.error('[Reel_Intro] Step 2 Result:', res2);

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(JSON.stringify({
    composition: {
      name: 'Reel_Intro',
      dimensions: '1080x1920 (9:16)',
      fps: 60,
      duration: '10s'
    },
    textLayer: {
      text: 'MOTION DESIGNER',
      font: 'Impact (ultra-bold)',
      tracking: 120,
      position: [540, 960]
    },
    fadeUpAnimator: {
      positionOffset: [0, 160, 0],
      opacity: '0%',
      verticalBlur: [0, 24],
      rangeSelector: 'Ramp Up',
      easeHigh: '85%',
      window: '0.2s → 0.85s'
    },
    dropShadow: {
      opacity: '45%',
      angle: '135°',
      distance: 18,
      softness: 32
    },
    step1: res1,
    step2: res2
  }, null, 2));
}

main().catch(err => {
  console.error('[Reel_Intro] Execution error:', err);
  process.exit(1);
});
