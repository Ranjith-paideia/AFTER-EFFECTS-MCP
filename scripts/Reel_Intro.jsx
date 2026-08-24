// ═══════════════════════════════════════════════════════════════════════════
// Reel_Intro.jsx — Standalone ExtendScript for After Effects
// Run via: File > Scripts > Run Script File…  (or AfterFX.exe -r)
// ═══════════════════════════════════════════════════════════════════════════

app.beginUndoGroup("Create Reel_Intro");

try {
    // ── Step 1: Create or find the composition ──────────────────────────────
    var comp = null;
    for (var i = 1; i <= app.project.numItems; i++) {
        if (app.project.item(i) instanceof CompItem && app.project.item(i).name === "Reel_Intro") {
            comp = app.project.item(i);
            break;
        }
    }
    if (!comp) {
        comp = app.project.items.addComp("Reel_Intro", 1080, 1920, 1.0, 10.0, 60.0);
    }
    comp.openInViewer();

    // ── Step 2: Add text layer ──────────────────────────────────────────────
    var textLayer = comp.layers.addText("MOTION DESIGNER");
    textLayer.name = "MOTION DESIGNER";

    var textProp = textLayer.property("ADBE Text Properties").property("ADBE Text Document");
    var textDoc = textProp.value;
    textDoc.font = "Impact";
    textDoc.fontSize = 110;
    textDoc.tracking = 120;
    textDoc.applyFill = true;
    textDoc.fillColor = [1, 1, 1];
    textDoc.justification = ParagraphJustification.CENTER_JUSTIFY;
    textDoc.allCaps = true;
    textProp.setValue(textDoc);

    // Center in 1080×1920
    textLayer.property("ADBE Transform Group").property("ADBE Position").setValue([540, 960]);

    // ── Step 3: FadeUp Text Animator ────────────────────────────────────────
    var animators = textLayer.property("ADBE Text Properties").property("ADBE Text Animators");
    var animator = animators.addProperty("ADBE Text Animator");
    animator.name = "FadeUp";

    var animProps = animator.property("ADBE Text Animator Properties");

    // Position offset: +160px Y
    var animPos = animProps.addProperty("ADBE Text Position 3D");
    animPos.setValue([0, 160, 0]);

    // Opacity: 0%
    var animOpacity = animProps.addProperty("ADBE Text Opacity");
    animOpacity.setValue(0);

    // Vertical Blur: 24px (Y-axis only)
    var animBlur = animProps.addProperty("ADBE Text Blur");
    animBlur.setValue([0, 24]);

    // ── Range Selector: Ramp Up, eased @ 85%, 0.2s → 0.85s ────────────────
    var selectors = animator.property("ADBE Text Selectors");
    var range = selectors.addProperty("ADBE Text Selector");

    var startProp = range.property("ADBE Text Percent Start");
    startProp.setValueAtTime(0.2, 0);
    startProp.setValueAtTime(0.85, 100);

    try {
        var advanced = range.property("ADBE Text Range Advanced");
        advanced.property("ADBE Text Selector Shape").setValue(2);   // Ramp Up
        advanced.property("ADBE Text Ease High").setValue(85);       // 85% ease
        advanced.property("ADBE Text Ease Low").setValue(0);
    } catch(e) {}

    // ── Step 4: Drop Shadow Effect ──────────────────────────────────────────
    var fxStack = textLayer.property("ADBE Effect Parade");
    var dropShadow = fxStack.addProperty("ADBE Drop Shadow");
    dropShadow.name = "Drop Shadow";

    try {
        dropShadow.property("Opacity").setValue(45);
        dropShadow.property("Direction").setValue(135);
        dropShadow.property("Distance").setValue(18);
        dropShadow.property("Softness").setValue(32);
    } catch(err) {
        try {
            dropShadow.property(2).setValue(45);
            dropShadow.property(3).setValue(135);
            dropShadow.property(4).setValue(18);
            dropShadow.property(5).setValue(32);
        } catch(e2) {}
    }

    alert("Reel_Intro created successfully!\n\n• 1080x1920 @ 60fps / 10s\n• MOTION DESIGNER (Impact, +120 tracking)\n• FadeUp Animator (Y+160, 0% opacity, 24px VBlur)\n• Ramp Up selector 85% ease (0.2s-0.85s)\n• Drop Shadow (45% / 135° / 18px / 32px)");

} catch(e) {
    alert("Error: " + e.toString());
}

app.endUndoGroup();
