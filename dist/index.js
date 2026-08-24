import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runExtendScript } from "./aeBridge.js";
import { inertia, wiggle, elasticSpring, staggerDelay, autoOrient, audioLink, autoResizeBox, autoResizeBoxPosition, loopCycle, timeRemap, random } from "./expressions.js";
const server = new McpServer({
    name: "after-effects-mcp",
    version: "1.0.0",
});
async function executeTool(scriptBody) {
    const raw = await runExtendScript(scriptBody);
    return { content: [{ type: "text", text: raw }] };
}
function getCompScript(compName) {
    if (!compName)
        return 'var comp = app.project.activeItem;\nif (!(comp instanceof CompItem)) throw new Error("No active composition");\n';
    return 'var comp = null;\nfor (var i = 1; i <= app.project.numItems; i++) {\n  if (app.project.item(i) instanceof CompItem && app.project.item(i).name === ' + JSON.stringify(compName) + ') {\n    comp = app.project.item(i);\n    break;\n  }\n}\nif (!comp) throw new Error("Composition not found: " + ' + JSON.stringify(compName) + ');\n';
}
// ============================================================================
// Suite 1: Timeline, Project & Slate Management
// ============================================================================
server.tool("create_composition", "Creates a new composition", {
    name: z.string().describe("Name of the composition"),
    width: z.number().optional().default(1920).describe("Width in pixels"),
    height: z.number().optional().default(1080).describe("Height in pixels"),
    fps: z.number().optional().default(29.97).describe("Frames per second"),
    duration: z.number().optional().default(10).describe("Duration in seconds"),
    preset: z.enum(['16:9', '9:16', '1:1', '4:5', '2.39:1']).optional().describe("Aspect ratio preset"),
    bitDepth: z.enum(['8', '16', '32']).optional().default('8').describe("Project color bit depth")
}, async (args) => {
    let w = args.width;
    let h = args.height;
    if (args.preset) {
        if (args.preset === '16:9') {
            w = 1920;
            h = 1080;
        }
        else if (args.preset === '9:16') {
            w = 1080;
            h = 1920;
        }
        else if (args.preset === '1:1') {
            w = 1080;
            h = 1080;
        }
        else if (args.preset === '4:5') {
            w = 1080;
            h = 1350;
        }
        else if (args.preset === '2.39:1') {
            w = 2048;
            h = 858;
        }
    }
    const script = `
      var comp = app.project.items.addComp(${JSON.stringify(args.name)}, ${w}, ${h}, 1, ${args.duration}, ${args.fps});
      app.project.bitsPerChannel = parseInt(${JSON.stringify(args.bitDepth)}, 10);
      'Comp created: ' + comp.name;
    `;
    return executeTool(script);
});
server.tool("generate_scene_slate", "Generates a production slate with scene, take, and director info", {
    scene: z.string().describe("Scene number/name"),
    take: z.string().optional().default('1').describe("Take number"),
    director: z.string().optional().default('').describe("Director name"),
    fps: z.number().optional().default(24).describe("Frames per second"),
    date: z.string().optional().describe("Production date"),
    width: z.number().optional().default(1920).describe("Comp width"),
    height: z.number().optional().default(1080).describe("Comp height")
}, async (args) => {
    const d = args.date || new Date().toISOString().split('T')[0];
    const script = `
      var comp = app.project.items.addComp("Slate - Scene " + ${JSON.stringify(args.scene)}, ${args.width}, ${args.height}, 1, 5, ${args.fps});
      comp.layers.addSolid([0,0,0], "Background", ${args.width}, ${args.height}, 1, 5);
      
      function addText(str, pos, size) {
        var layer = comp.layers.addText(str);
        var doc = layer.sourceText.value;
        doc.fontSize = size;
        doc.fillColor = [1,1,1];
        layer.sourceText.setValue(doc);
        layer.property("ADBE Transform Group").property("ADBE Position").setValue(pos);
      }
      
      addText("SCENE: " + ${JSON.stringify(args.scene)}, [100, 200], 100);
      addText("TAKE: " + ${JSON.stringify(args.take)}, [100, 350], 80);
      addText("DIRECTOR: " + ${JSON.stringify(args.director)}, [100, 500], 60);
      addText("FPS: " + ${args.fps}, [100, 650], 50);
      addText("DATE: " + ${JSON.stringify(d)}, [100, 800], 50);
      'Slate generated.';
    `;
    return executeTool(script);
});
server.tool("set_timeline_markers", "Sets composition timeline markers", {
    compName: z.string().optional().describe("Target composition name"),
    markers: z.array(z.object({
        time: z.number().describe("Time in seconds"),
        comment: z.string().describe("Marker comment"),
        color: z.number().optional().describe("Marker color index")
    })).describe("List of markers to add")
}, async (args) => {
    const script = getCompScript(args.compName) + `
      var markers = ${JSON.stringify(args.markers)};
      for (var i = 0; i < markers.length; i++) {
        var m = markers[i];
        var mv = new MarkerValue(m.comment);
        if (m.color !== undefined) {
          mv.label = m.color;
        }
        comp.markerProperty.setValueAtTime(m.time, mv);
      }
      'Markers added.';
    `;
    return executeTool(script);
});
server.tool("create_adjustment_layer", "Creates an adjustment layer in the composition", {
    compName: z.string().optional().describe("Target composition name"),
    name: z.string().optional().default('Adjustment Layer').describe("Layer name"),
    label: z.number().optional().describe("Label color index")
}, async (args) => {
    const script = getCompScript(args.compName) + `
      var layer = comp.layers.addSolid([1,1,1], ${JSON.stringify(args.name)}, comp.width, comp.height, 1, comp.duration);
      layer.adjustmentLayer = true;
      if (${args.label !== undefined}) {
        layer.label = ${args.label !== undefined ? args.label : 'layer.label'};
      }
      'Adjustment layer created.';
    `;
    return executeTool(script);
});
// ============================================================================
// Suite 2: Advanced Keyframing, Curves & Easing
// ============================================================================
server.tool("animate_transform_with_curves", "Animates a transform property with specified keyframes and easing curves", {
    layerIndex: z.number().describe("1-based layer index"),
    property: z.enum(['Position', 'Scale', 'Rotation', 'Opacity', 'Anchor Point']).describe("Transform property"),
    keyframes: z.array(z.object({
        time: z.number(),
        value: z.union([z.number(), z.array(z.number())]),
        easeIn: z.object({ speed: z.number().optional().default(0), influence: z.number().min(0.1).max(100).optional().default(33.33) }).optional(),
        easeOut: z.object({ speed: z.number().optional().default(0), influence: z.number().min(0.1).max(100).optional().default(33.33) }).optional()
    })).describe("Keyframe data"),
    compName: z.string().optional().describe("Target composition name")
}, async (args) => {
    const propMap = {
        'Position': 'ADBE Position',
        'Scale': 'ADBE Scale',
        'Rotation': 'ADBE Rotate Z',
        'Opacity': 'ADBE Opacity',
        'Anchor Point': 'ADBE Anchor Point'
    };
    const matchName = propMap[args.property];
    const script = getCompScript(args.compName) + `
      var layer = comp.layer(${args.layerIndex});
      var prop = layer.property("ADBE Transform Group").property(${JSON.stringify(matchName)});
      var kfs = ${JSON.stringify(args.keyframes)};
      
      for (var i = 0; i < kfs.length; i++) {
        var kf = kfs[i];
        prop.setValueAtTime(kf.time, kf.value);
      }
      
      for (var j = 0; j < kfs.length; j++) {
        var kfIndex = j + 1; // After Effects keyframe indices are 1-based
        var kf = kfs[j];
        prop.setInterpolationTypeAtKey(kfIndex, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
        
        var inSpeed = (kf.easeIn && kf.easeIn.speed !== undefined) ? kf.easeIn.speed : 0;
        var inInf = (kf.easeIn && kf.easeIn.influence !== undefined) ? kf.easeIn.influence : 33.33;
        var outSpeed = (kf.easeOut && kf.easeOut.speed !== undefined) ? kf.easeOut.speed : 0;
        var outInf = (kf.easeOut && kf.easeOut.influence !== undefined) ? kf.easeOut.influence : 33.33;
        
        var easeInObj = new KeyframeEase(inSpeed, inInf);
        var easeOutObj = new KeyframeEase(outSpeed, outInf);
        
        // Handle multi-dimensional properties
        if (prop.propertyValueType === PropertyValueType.TwoD_SPATIAL || prop.propertyValueType === PropertyValueType.TwoD || prop.propertyValueType === PropertyValueType.ThreeD_SPATIAL || prop.propertyValueType === PropertyValueType.ThreeD) {
          var dim = (prop.propertyValueType === PropertyValueType.TwoD_SPATIAL || prop.propertyValueType === PropertyValueType.TwoD) ? 2 : 3;
          var inArr = []; var outArr = [];
          for (var d = 0; d < dim; d++) {
             inArr.push(easeInObj);
             outArr.push(easeOutObj);
          }
          prop.setTemporalEaseAtKey(kfIndex, inArr, outArr);
        } else {
          prop.setTemporalEaseAtKey(kfIndex, [easeInObj], [easeOutObj]);
        }
      }
      'Animation applied.';
    `;
    return executeTool(script);
});
server.tool("separate_position_dimensions", "Separates the position dimensions (X, Y, Z) of a layer", {
    layerIndex: z.number().describe("1-based layer index"),
    compName: z.string().optional().describe("Target composition name")
}, async (args) => {
    const script = getCompScript(args.compName) + `
      comp.layer(${args.layerIndex}).property("ADBE Transform Group").property("ADBE Position").dimensionsSeparated = true;
      'Position dimensions separated.';
    `;
    return executeTool(script);
});
server.tool("create_motion_path", "Creates a motion path animation with optional auto-orientation", {
    layerIndex: z.number().describe("1-based layer index"),
    points: z.array(z.object({
        time: z.number(),
        x: z.number(),
        y: z.number(),
        z: z.number().optional()
    })).describe("Path points over time"),
    autoOrientToPath: z.boolean().optional().default(false).describe("Orient along path"),
    compName: z.string().optional().describe("Target composition name")
}, async (args) => {
    const script = getCompScript(args.compName) + `
      var layer = comp.layer(${args.layerIndex});
      var posProp = layer.property("ADBE Transform Group").property("ADBE Position");
      var pts = ${JSON.stringify(args.points)};
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        var val = p.z !== undefined ? [p.x, p.y, p.z] : [p.x, p.y];
        posProp.setValueAtTime(p.time, val);
      }
      if (${args.autoOrientToPath}) {
        layer.autoOrient = AutoOrientType.ALONG_PATH;
      }
      'Motion path created.';
    `;
    return executeTool(script);
});
// ============================================================================
// Suite 3: Shape Layers, Vectors & HUD Accents
// ============================================================================
server.tool("create_shape_with_trim_paths", "Creates a shape layer with trim paths applied", {
    shapeType: z.enum(['rectangle', 'ellipse', 'star', 'polygon']).describe("Base shape type"),
    compName: z.string().optional().describe("Target composition name"),
    name: z.string().optional().describe("Layer name"),
    position: z.array(z.number()).optional().describe("Position [x, y]"),
    size: z.array(z.number()).optional().default([200, 200]).describe("Size [width, height]"),
    fillColor: z.array(z.number()).optional().describe("Fill color [r,g,b] (0-1)"),
    strokeColor: z.array(z.number()).optional().describe("Stroke color [r,g,b] (0-1)"),
    strokeWidth: z.number().optional().default(2).describe("Stroke width"),
    trimStart: z.number().optional().describe("Trim Paths Start %"),
    trimEnd: z.number().optional().default(100).describe("Trim Paths End %"),
    trimOffset: z.number().optional().default(0).describe("Trim Paths Offset degrees"),
    points: z.number().optional().default(5).describe("Points for star/polygon")
}, async (args) => {
    let shapeMatch = "";
    if (args.shapeType === 'rectangle')
        shapeMatch = "ADBE Vector Shape - Rect";
    else if (args.shapeType === 'ellipse')
        shapeMatch = "ADBE Vector Shape - Ellipse";
    else if (args.shapeType === 'star' || args.shapeType === 'polygon')
        shapeMatch = "ADBE Vector Shape - Star";
    const script = getCompScript(args.compName) + `
      var layer = comp.layers.addShape();
      if (${JSON.stringify(args.name)}) layer.name = ${JSON.stringify(args.name)};
      if (${JSON.stringify(args.position)}) {
         layer.property("ADBE Transform Group").property("ADBE Position").setValue(${JSON.stringify(args.position)});
      }
      
      var contents = layer.property("ADBE Root Vectors Group");
      var group = contents.addProperty("ADBE Vector Group");
      var groupContents = group.property("ADBE Vectors Group");
      
      var shape = groupContents.addProperty(${JSON.stringify(shapeMatch)});
      if (${JSON.stringify(args.shapeType)} === 'polygon') {
         shape.property("ADBE Vector Star Type").setValue(2); // 2 = Polygon
      }
      if (${JSON.stringify(args.shapeType)} === 'star' || ${JSON.stringify(args.shapeType)} === 'polygon') {
         shape.property("ADBE Vector Star Points").setValue(${args.points});
         shape.property("ADBE Vector Star Outer Radius").setValue(${args.size[0] / 2});
      } else {
         shape.property("ADBE Vector Rect Size").setValue(${JSON.stringify(args.size)});
      }
      
      if (${JSON.stringify(args.fillColor)}) {
         var fill = groupContents.addProperty("ADBE Vector Graphic - Fill");
         fill.property("ADBE Vector Fill Color").setValue(${JSON.stringify(args.fillColor)});
      }
      if (${JSON.stringify(args.strokeColor)}) {
         var stroke = groupContents.addProperty("ADBE Vector Graphic - Stroke");
         stroke.property("ADBE Vector Stroke Color").setValue(${JSON.stringify(args.strokeColor)});
         stroke.property("ADBE Vector Stroke Width").setValue(${args.strokeWidth});
      }
      
      if (${args.trimStart !== undefined} || ${args.trimEnd !== undefined}) {
         var trim = contents.addProperty("ADBE Vector Filter - Trim");
         if (${args.trimStart !== undefined}) trim.property("ADBE Vector Trim Start").setValue(${args.trimStart});
         trim.property("ADBE Vector Trim End").setValue(${args.trimEnd});
         trim.property("ADBE Vector Trim Offset").setValue(${args.trimOffset});
      }
      'Shape with trim paths created.';
    `;
    return executeTool(script);
});
server.tool("generate_shape_repeater", "Generates a shape repeater setup", {
    compName: z.string().optional().describe("Target composition name"),
    name: z.string().optional().describe("Layer name"),
    shapeType: z.enum(['rectangle', 'ellipse', 'star']).optional().default('rectangle').describe("Base shape type"),
    copies: z.number().optional().default(8).describe("Number of copies"),
    offset: z.object({
        position: z.array(z.number()).optional(),
        rotation: z.number().optional(),
        scale: z.array(z.number()).optional(),
        opacity: z.number().optional()
    }).optional().describe("Repeater transform offset")
}, async (args) => {
    let shapeMatch = "ADBE Vector Shape - Rect";
    if (args.shapeType === 'ellipse')
        shapeMatch = "ADBE Vector Shape - Ellipse";
    else if (args.shapeType === 'star')
        shapeMatch = "ADBE Vector Shape - Star";
    const script = getCompScript(args.compName) + `
      var layer = comp.layers.addShape();
      if (${JSON.stringify(args.name)}) layer.name = ${JSON.stringify(args.name)};
      var contents = layer.property("ADBE Root Vectors Group");
      var group = contents.addProperty("ADBE Vector Group");
      var groupContents = group.property("ADBE Vectors Group");
      groupContents.addProperty(${JSON.stringify(shapeMatch)});
      groupContents.addProperty("ADBE Vector Graphic - Stroke");
      
      var rep = contents.addProperty("ADBE Vector Filter - Repeater");
      rep.property("ADBE Vector Repeater Copies").setValue(${args.copies});
      
      var repTransform = rep.property("ADBE Vector Repeater Transform");
      var offset = ${JSON.stringify(args.offset || {})};
      if (offset.position) repTransform.property("ADBE Vector Repeater Position").setValue(offset.position);
      if (offset.rotation !== undefined) repTransform.property("ADBE Vector Repeater Rotation").setValue(offset.rotation);
      if (offset.scale) repTransform.property("ADBE Vector Repeater Scale").setValue(offset.scale);
      if (offset.opacity !== undefined) repTransform.property("ADBE Vector Repeater Opacity").setValue(offset.opacity);
      
      'Shape repeater generated.';
    `;
    return executeTool(script);
});
server.tool("apply_shape_modifiers", "Applies a vector modifier filter to a shape layer", {
    layerIndex: z.number().describe("1-based layer index"),
    compName: z.string().optional().describe("Target composition name"),
    modifier: z.enum(['zigzag', 'pucker_bloat', 'offset_paths', 'round_corners']).describe("Modifier type"),
    params: z.record(z.string(), z.number()).optional().describe("Modifier parameters (matchName to value)")
}, async (args) => {
    const modMap = {
        'zigzag': 'ADBE Vector Filter - Zigzag',
        'pucker_bloat': 'ADBE Vector Filter - PB',
        'offset_paths': 'ADBE Vector Filter - Offset',
        'round_corners': 'ADBE Vector Filter - RC'
    };
    const script = getCompScript(args.compName) + `
      var layer = comp.layer(${args.layerIndex});
      var contents = layer.property("ADBE Root Vectors Group");
      var group = contents.property(1); // Usually the main group
      var dest = group && group.matchName === "ADBE Vector Group" ? group.property("ADBE Vectors Group") : contents;
      
      var mod = dest.addProperty(${JSON.stringify(modMap[args.modifier])});
      var params = ${JSON.stringify(args.params || {})};
      for (var k in params) {
         if (params.hasOwnProperty(k)) {
            mod.property(k).setValue(params[k]);
         }
      }
      'Shape modifier applied.';
    `;
    return executeTool(script);
});
// ============================================================================
// Suite 4: Kinetic Typography & Subtitles
// ============================================================================
server.tool("create_kinetic_text", "Creates styled text for kinetic typography", {
    text: z.string().describe("Text content"),
    compName: z.string().optional().describe("Target composition name"),
    font: z.string().optional().default('Arial').describe("Font name"),
    fontSize: z.number().optional().default(72).describe("Font size"),
    tracking: z.number().optional().default(0).describe("Tracking"),
    leading: z.number().optional().describe("Leading"),
    alignment: z.enum(['left', 'center', 'right']).optional().default('center').describe("Paragraph alignment"),
    fauxBold: z.boolean().optional().default(false).describe("Faux bold"),
    allCaps: z.boolean().optional().default(false).describe("All caps"),
    color: z.array(z.number()).optional().default([1, 1, 1]).describe("Fill color [r,g,b] (0-1)"),
    position: z.array(z.number()).optional().describe("Layer position [x,y]")
}, async (args) => {
    const alignMap = {
        'left': 'ParagraphJustification.LEFT_JUSTIFY',
        'center': 'ParagraphJustification.CENTER_JUSTIFY',
        'right': 'ParagraphJustification.RIGHT_JUSTIFY'
    };
    const script = getCompScript(args.compName) + `
      var textLayer = comp.layers.addText(${JSON.stringify(args.text)});
      var textProp = textLayer.property("ADBE Text Properties").property("ADBE Text Document");
      var textDoc = textProp.value;
      textDoc.font = ${JSON.stringify(args.font)};
      textDoc.fontSize = ${args.fontSize};
      textDoc.tracking = ${args.tracking};
      if (${args.leading !== undefined}) textDoc.leading = ${args.leading !== undefined ? args.leading : 0};
      textDoc.justification = ${alignMap[args.alignment]};
      textDoc.fauxBold = ${args.fauxBold};
      textDoc.allCaps = ${args.allCaps};
      textDoc.applyFill = true;
      textDoc.fillColor = ${JSON.stringify(args.color)};
      textProp.setValue(textDoc);
      
      if (${JSON.stringify(args.position)}) {
         textLayer.property("ADBE Transform Group").property("ADBE Position").setValue(${JSON.stringify(args.position)});
      }
      'Kinetic text created.';
    `;
    return executeTool(script);
});
server.tool("apply_text_animator", "Applies a pre-configured text animator preset", {
    layerIndex: z.number().describe("1-based layer index of text layer"),
    compName: z.string().optional().describe("Target composition name"),
    preset: z.enum(['typewriter', 'tracking_expander', 'blur_fade', 'elastic_scale', '3d_cascade']).describe("Animator preset"),
    duration: z.number().optional().default(1).describe("Animation duration"),
    stagger: z.number().optional().default(0.05).describe("Stagger time per character")
}, async (args) => {
    const script = getCompScript(args.compName) + `
      var layer = comp.layer(${args.layerIndex});
      var animators = layer.property("ADBE Text Properties").property("ADBE Text Animators");
      var animator = animators.addProperty("ADBE Text Animator");
      var props = animator.property("ADBE Text Animator Properties");
      var selectors = animator.property("ADBE Text Selectors");
      var range = selectors.addProperty("ADBE Text Selector");
      
      var preset = ${JSON.stringify(args.preset)};
      var dur = ${args.duration};
      
      if (preset === 'typewriter') {
         props.addProperty("ADBE Text Opacity").setValue(0);
         range.property("ADBE Text Percent Start").setValueAtTime(0, 0);
         range.property("ADBE Text Percent Start").setValueAtTime(dur, 100);
      }
      else if (preset === 'tracking_expander') {
         props.addProperty("ADBE Text Tracking Amount").setValue(50);
         range.property("ADBE Text Percent Start").setValueAtTime(0, 0);
         range.property("ADBE Text Percent Start").setValueAtTime(dur, 100);
      }
      else if (preset === 'blur_fade') {
         props.addProperty("ADBE Text Opacity").setValue(0);
         props.addProperty("ADBE Text Blur").setValue([20,20]);
         range.property("ADBE Text Percent Start").setValueAtTime(0, 0);
         range.property("ADBE Text Percent Start").setValueAtTime(dur, 100);
      }
      else if (preset === 'elastic_scale') {
         props.addProperty("ADBE Text Scale 3D").setValue([0,0,0]);
         range.property("ADBE Text Percent Start").setValueAtTime(0, 0);
         range.property("ADBE Text Percent Start").setValueAtTime(dur, 100);
      }
      else if (preset === '3d_cascade') {
         layer.threeDLayer = true;
         props.addProperty("ADBE Text Position 3D").setValue([0, 100, 0]);
         props.addProperty("ADBE Text Opacity").setValue(0);
         range.property("ADBE Text Percent Start").setValueAtTime(0, 0);
         range.property("ADBE Text Percent Start").setValueAtTime(dur, 100);
      }
      'Text animator applied.';
    `;
    return executeTool(script);
});
server.tool("build_auto_resizing_subtitle_box", "Builds a text layer with a dynamic auto-resizing background box", {
    text: z.string().describe("Subtitle text"),
    compName: z.string().optional().describe("Target composition name"),
    padding: z.array(z.number()).optional().default([20, 10]).describe("Box padding [x, y]"),
    bgColor: z.array(z.number()).optional().default([0, 0, 0]).describe("Background color [r,g,b] (0-1)"),
    bgOpacity: z.number().optional().default(80).describe("Background opacity (0-100)"),
    textColor: z.array(z.number()).optional().default([1, 1, 1]).describe("Text color [r,g,b] (0-1)"),
    font: z.string().optional().default('Arial').describe("Font name"),
    fontSize: z.number().optional().default(48).describe("Font size"),
    yPosition: z.number().optional().describe("Y position for the bottom third")
}, async (args) => {
    const exprSize = autoResizeBox({ padding: [args.padding[0], args.padding[1]] });
    const exprPos = autoResizeBoxPosition({});
    const script = getCompScript(args.compName) + `
      var textLayer = comp.layers.addText(${JSON.stringify(args.text)});
      textLayer.name = "Subtitle";
      var doc = textLayer.property("ADBE Text Properties").property("ADBE Text Document").value;
      doc.font = ${JSON.stringify(args.font)};
      doc.fontSize = ${args.fontSize};
      doc.fillColor = ${JSON.stringify(args.textColor)};
      doc.applyFill = true;
      doc.justification = ParagraphJustification.CENTER_JUSTIFY;
      textLayer.property("ADBE Text Properties").property("ADBE Text Document").setValue(doc);
      
      var yPos = ${args.yPosition !== undefined ? args.yPosition : 'comp.height * 0.85'};
      textLayer.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width/2, yPos]);
      
      var bgLayer = comp.layers.addShape();
      bgLayer.name = "Subtitle BG";
      bgLayer.moveAfter(textLayer);
      
      var contents = bgLayer.property("ADBE Root Vectors Group");
      var group = contents.addProperty("ADBE Vector Group");
      var groupContents = group.property("ADBE Vectors Group");
      
      var rect = groupContents.addProperty("ADBE Vector Shape - Rect");
      rect.property("ADBE Vector Rect Size").expression = ${JSON.stringify(exprSize)};
      
      var fill = groupContents.addProperty("ADBE Vector Graphic - Fill");
      fill.property("ADBE Vector Fill Color").setValue(${JSON.stringify(args.bgColor)});
      
      bgLayer.property("ADBE Transform Group").property("ADBE Opacity").setValue(${args.bgOpacity});
      bgLayer.property("ADBE Transform Group").property("ADBE Position").expression = ${JSON.stringify(exprPos)};
      
      'Auto-resizing subtitle box built.';
    `;
    return executeTool(script);
});
// ============================================================================
// Suite 5: 3D Systems, Camera Rigs & Hierarchy
// ============================================================================
server.tool("build_master_null_rig", "Parents multiple target layers to a newly created Master Null", {
    compName: z.string().optional().describe("Target composition name"),
    nullName: z.string().optional().default('Master Null').describe("Name of the null layer"),
    targetLayers: z.array(z.number()).describe("Array of 1-based layer indices to parent"),
    is3D: z.boolean().optional().default(false).describe("Make the null 3D")
}, async (args) => {
    const script = getCompScript(args.compName) + `
      var nullLayer = comp.layers.addNull();
      nullLayer.name = ${JSON.stringify(args.nullName)};
      nullLayer.threeDLayer = ${args.is3D};
      
      var targets = ${JSON.stringify(args.targetLayers)};
      for (var i = 0; i < targets.length; i++) {
         var tLayer = comp.layer(targets[i] + 1); // Compensating for the newly added null layer pushing indices down
         if (tLayer) tLayer.setParentWithJump(nullLayer);
      }
      'Master null rig built.';
    `;
    return executeTool(script);
});
server.tool("create_camera_orbit_rig", "Creates a camera parented to a 3D null for orbit control", {
    compName: z.string().optional().describe("Target composition name"),
    focalLength: z.number().optional().default(50).describe("Camera focal length in mm"),
    depthOfField: z.boolean().optional().default(false).describe("Enable Depth of Field"),
    orbitRadius: z.number().optional().default(500).describe("Distance of camera from null center")
}, async (args) => {
    const script = getCompScript(args.compName) + `
      var ctrl = comp.layers.addNull();
      ctrl.name = "Orbit Controller";
      ctrl.threeDLayer = true;
      ctrl.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width/2, comp.height/2, 0]);
      
      var cam = comp.layers.addCamera("Camera", [comp.width/2, comp.height/2]);
      cam.parent = ctrl;
      cam.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width/2, comp.height/2, -${args.orbitRadius}]);
      
      // Calculate zoom based on focal length and comp width (rough approximation for standard 35mm equivalent)
      var zoom = (comp.width / 2) / Math.tan((${args.focalLength} / 36) / 2);
      cam.property("ADBE Camera Options Group").property("ADBE Camera Zoom").setValue(zoom);
      
      if (${args.depthOfField}) {
         cam.property("ADBE Camera Options Group").property("ADBE Camera Depth of Field").setValue(1);
      }
      'Camera orbit rig created.';
    `;
    return executeTool(script);
});
server.tool("add_expression_controllers", "Adds expression control effects to a layer", {
    layerIndex: z.number().describe("1-based layer index"),
    compName: z.string().optional().describe("Target composition name"),
    controllers: z.array(z.object({
        type: z.enum(['slider', 'angle', 'color', 'point', 'checkbox', 'dropdown']).describe("Control type"),
        name: z.string().describe("Control name")
    })).describe("Controllers to add")
}, async (args) => {
    const typeMap = {
        'slider': 'ADBE Slider Control',
        'angle': 'ADBE Angle Control',
        'color': 'ADBE Color Control',
        'point': 'ADBE Point Control',
        'checkbox': 'ADBE Checkbox Control',
        'dropdown': 'ADBE Dropdown Control'
    };
    const script = getCompScript(args.compName) + `
      var layer = comp.layer(${args.layerIndex});
      var fx = layer.property("ADBE Effect Parade");
      var ctrls = ${JSON.stringify(args.controllers)};
      var map = ${JSON.stringify(typeMap)};
      
      for (var i = 0; i < ctrls.length; i++) {
         var c = ctrls[i];
         var matchName = map[c.type];
         var newFx = fx.addProperty(matchName);
         newFx.name = c.name;
      }
      'Expression controllers added.';
    `;
    return executeTool(script);
});
// ============================================================================
// Suite 6: VFX, Transitions & Effect Parade
// ============================================================================
server.tool("apply_effect_stack", "Applies a stack of effects with optional parameters to a layer", {
    layerIndex: z.number().describe("1-based layer index"),
    compName: z.string().optional().describe("Target composition name"),
    effects: z.array(z.object({
        matchName: z.string().describe("Effect matchName (e.g. ADBE Gaussian Blur 2)"),
        params: z.record(z.string(), z.union([z.number(), z.string(), z.array(z.number()), z.boolean()])).optional().describe("Property matchName to value map")
    })).describe("Effects stack to apply")
}, async (args) => {
    const script = getCompScript(args.compName) + `
      var layer = comp.layer(${args.layerIndex});
      var fxStack = layer.property("ADBE Effect Parade");
      var effs = ${JSON.stringify(args.effects)};
      
      for (var i = 0; i < effs.length; i++) {
         var e = effs[i];
         var fx = fxStack.addProperty(e.matchName);
         if (e.params) {
            for (var k in e.params) {
               if (e.params.hasOwnProperty(k)) {
                  fx.property(k).setValue(e.params[k]);
               }
            }
         }
      }
      'Effect stack applied.';
    `;
    return executeTool(script);
});
server.tool("create_displacement_glitch", "Creates a procedural glitch effect using displacement maps", {
    layerIndex: z.number().describe("1-based target layer index"),
    compName: z.string().optional().describe("Target composition name"),
    intensity: z.number().optional().default(50).describe("Max displacement intensity"),
    speed: z.number().optional().default(10).describe("Glitch evolution speed"),
    duration: z.number().optional().describe("Duration of the noise map layer")
}, async (args) => {
    const script = getCompScript(args.compName) + `
      var targetLayer = comp.layer(${args.layerIndex});
      var dur = ${args.duration !== undefined ? args.duration : 'comp.duration'};
      var mapLayer = comp.layers.addSolid([0.5,0.5,0.5], "Glitch Map", comp.width, comp.height, 1, dur);
      mapLayer.enabled = false;
      
      var noise = mapLayer.property("ADBE Effect Parade").addProperty("ADBE Fractal Noise");
      noise.property("ADBE Fractal Noise-0002").setValue(2); // Noise Type: Block
      noise.property("ADBE Fractal Noise-0008").setValue(500); // Contrast
      noise.property("ADBE Fractal Noise-0015").setValue([500, 50]); // Scale
      noise.property("ADBE Fractal Noise-0017").expression = "time * " + ${args.speed} + " * 100";
      
      var disp = targetLayer.property("ADBE Effect Parade").addProperty("ADBE Displacement Map");
      disp.property("ADBE Displacement Map-0001").setValue(mapLayer.index);
      disp.property("ADBE Displacement Map-0004").setValue(${args.intensity});
      disp.property("ADBE Displacement Map-0005").setValue(${args.intensity});
      
      'Displacement glitch created.';
    `;
    return executeTool(script);
});
server.tool("create_gradient_light_leak", "Generates a gradient ramp light leak layer", {
    compName: z.string().optional().describe("Target composition name"),
    color1: z.array(z.number()).optional().default([1, 0.8, 0.2]).describe("Start color [r,g,b] (0-1)"),
    color2: z.array(z.number()).optional().default([1, 0.2, 0.1]).describe("End color [r,g,b] (0-1)"),
    blendMode: z.enum(['screen', 'add', 'overlay']).optional().default('screen').describe("Blending mode"),
    opacity: z.number().optional().default(70).describe("Max opacity")
}, async (args) => {
    const blendMap = {
        'screen': 'BlendingMode.SCREEN',
        'add': 'BlendingMode.ADD',
        'overlay': 'BlendingMode.OVERLAY'
    };
    const script = getCompScript(args.compName) + `
      var ll = comp.layers.addSolid([0,0,0], "Light Leak", comp.width, comp.height, 1, comp.duration);
      ll.blendingMode = ${blendMap[args.blendMode]};
      
      var ramp = ll.property("ADBE Effect Parade").addProperty("ADBE Ramp");
      ramp.property("ADBE Ramp-0003").setValue(${JSON.stringify(args.color1)});
      ramp.property("ADBE Ramp-0005").setValue(${JSON.stringify(args.color2)});
      ramp.property("ADBE Ramp-0007").setValue(50); // Scatter
      
      var op = ll.property("ADBE Transform Group").property("ADBE Opacity");
      op.setValueAtTime(0, 0);
      op.setValueAtTime(comp.duration / 2, ${args.opacity});
      op.setValueAtTime(comp.duration, 0);
      
      'Light leak generated.';
    `;
    return executeTool(script);
});
// ============================================================================
// Suite 7: Audio Reactivity & Automation
// ============================================================================
server.tool("convert_audio_to_keyframes", "Runs 'Convert Audio to Keyframes' command on an audio layer", {
    audioLayerIndex: z.number().describe("1-based index of the audio layer"),
    compName: z.string().optional().describe("Target composition name")
}, async (args) => {
    const script = getCompScript(args.compName) + `
      for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
      comp.layer(${args.audioLayerIndex}).selected = true;
      app.executeCommand(app.findMenuCommandId("Convert Audio to Keyframes"));
      'Audio converted to keyframes.';
    `;
    return executeTool(script);
});
server.tool("link_property_to_audio", "Links a property to audio keyframes using expressions", {
    targetLayerIndex: z.number().describe("1-based index of target layer"),
    property: z.string().describe("Property matchName to link"),
    audioLayerIndex: z.number().optional().default(1).describe("1-based index of Audio Amplitude layer"),
    minVal: z.number().optional().default(0).describe("Minimum output value"),
    maxVal: z.number().optional().default(100).describe("Maximum output value"),
    channel: z.enum(['left', 'right', 'both']).optional().default('both').describe("Audio channel"),
    compName: z.string().optional().describe("Target composition name")
}, async (args) => {
    const expr = audioLink({ minVal: args.minVal, maxVal: args.maxVal, channel: args.channel });
    const script = getCompScript(args.compName) + `
      var targetProp = comp.layer(${args.targetLayerIndex}).property(${JSON.stringify(args.property)});
      // Simple path resolution (assumes top-level or Transform)
      if (!targetProp) targetProp = comp.layer(${args.targetLayerIndex}).property("ADBE Transform Group").property(${JSON.stringify(args.property)});
      
      if (targetProp) {
         targetProp.expression = ${JSON.stringify(expr)};
      } else {
         throw new Error("Property not found on target layer.");
      }
      'Linked property to audio.';
    `;
    return executeTool(script);
});
// ============================================================================
// Suite 8: Render Queue & Raw Execution
// ============================================================================
server.tool("add_to_render_queue", "Adds a composition to the Render Queue", {
    compName: z.string().optional().describe("Target composition name (defaults to active item)"),
    outputPath: z.string().describe("Absolute file path for output render"),
    template: z.string().optional().describe("Output Module Template name")
}, async (args) => {
    const script = getCompScript(args.compName) + `
      var rqi = app.project.renderQueue.items.add(comp);
      var om = rqi.outputModule(1);
      if (${JSON.stringify(args.template)}) {
         om.applyTemplate(${JSON.stringify(args.template)});
      }
      om.file = new File(${JSON.stringify(args.outputPath)});
      'Added to render queue. RQI Index: ' + rqi.index;
    `;
    return executeTool(script);
});
server.tool("execute_raw_extendscript", "Executes raw ExtendScript code directly. Use this as an escape hatch for arbitrary logic.", {
    script: z.string().describe("Raw ExtendScript code string to execute")
}, async (args) => {
    return executeTool(args.script);
});
// ============================================================================
// Suite X: Additional Tools
// ============================================================================
server.tool("get_project_info", "Gets basic information about the active project", {}, async () => {
    const script = `
      var p = app.project;
      var activeName = p.activeItem ? p.activeItem.name : "None";
      var res = {
        name: p.file ? p.file.name : "Untitled",
        path: p.file ? p.file.fsName : "Unsaved",
        numItems: p.numItems,
        activeItem: activeName
      };
      JSON.stringify(res);
    `;
    return executeTool(script);
});
server.tool("get_composition_info", "Gets detailed information about a composition", {
    compName: z.string().optional().describe("Composition name (defaults to active)")
}, async (args) => {
    const script = getCompScript(args.compName) + `
      var layers = [];
      for(var i=1; i<=comp.numLayers; i++) {
         layers.push({ name: comp.layer(i).name, index: comp.layer(i).index });
      }
      var res = {
        name: comp.name,
        width: comp.width,
        height: comp.height,
        fps: comp.frameRate,
        duration: comp.duration,
        numLayers: comp.numLayers,
        layers: layers
      };
      JSON.stringify(res);
    `;
    return executeTool(script);
});
server.tool("set_layer_properties", "Sets standard properties on a layer", {
    layerIndex: z.number().describe("1-based layer index"),
    compName: z.string().optional().describe("Target composition name"),
    properties: z.object({
        name: z.string().optional(),
        enabled: z.boolean().optional(),
        solo: z.boolean().optional(),
        shy: z.boolean().optional(),
        locked: z.boolean().optional(),
        label: z.number().optional(),
        blendingMode: z.string().optional(),
        inPoint: z.number().optional(),
        outPoint: z.number().optional(),
        startTime: z.number().optional(),
        threeDLayer: z.boolean().optional()
    }).describe("Properties to apply")
}, async (args) => {
    const script = getCompScript(args.compName) + `
      var layer = comp.layer(${args.layerIndex});
      var props = ${JSON.stringify(args.properties)};
      if (props.name !== undefined) layer.name = props.name;
      if (props.enabled !== undefined) layer.enabled = props.enabled;
      if (props.solo !== undefined) layer.solo = props.solo;
      if (props.shy !== undefined) layer.shy = props.shy;
      if (props.locked !== undefined) layer.locked = props.locked;
      if (props.label !== undefined) layer.label = props.label;
      if (props.inPoint !== undefined) layer.inPoint = props.inPoint;
      if (props.outPoint !== undefined) layer.outPoint = props.outPoint;
      if (props.startTime !== undefined) layer.startTime = props.startTime;
      if (props.threeDLayer !== undefined) layer.threeDLayer = props.threeDLayer;
      'Layer properties updated.';
    `;
    return executeTool(script);
});
server.tool("duplicate_layer", "Duplicates a layer in the composition one or more times", {
    layerIndex: z.number().describe("1-based layer index"),
    compName: z.string().optional().describe("Target composition name"),
    count: z.number().optional().default(1).describe("Number of duplicates to create")
}, async (args) => {
    const script = getCompScript(args.compName) + `
      var layer = comp.layer(${args.layerIndex});
      var count = ${args.count};
      for (var i = 0; i < count; i++) {
         layer.duplicate();
      }
      'Layer duplicated ' + count + ' times.';
    `;
    return executeTool(script);
});
server.tool("delete_layer", "Deletes a layer from the composition", {
    layerIndex: z.number().describe("1-based layer index"),
    compName: z.string().optional().describe("Target composition name")
}, async (args) => {
    const script = getCompScript(args.compName) + `
      comp.layer(${args.layerIndex}).remove();
      'Layer deleted.';
    `;
    return executeTool(script);
});
server.tool("apply_expression", "Applies an expression string or preset to a property", {
    layerIndex: z.number().describe("1-based layer index"),
    property: z.string().describe("Property path/matchName"),
    expression: z.string().describe("Raw expression string (used if preset is omitted)"),
    preset: z.string().optional().describe("Expression preset name (inertia, wiggle, etc.)"),
    presetParams: z.record(z.string(), z.any()).optional().describe("Parameters for the preset function"),
    compName: z.string().optional().describe("Target composition name")
}, async (args) => {
    let exprStr = args.expression;
    if (args.preset) {
        if (args.preset === 'inertia')
            exprStr = inertia(args.presetParams);
        else if (args.preset === 'wiggle')
            exprStr = wiggle(args.presetParams);
        else if (args.preset === 'elasticSpring')
            exprStr = elasticSpring(args.presetParams);
        else if (args.preset === 'staggerDelay')
            exprStr = staggerDelay(args.presetParams);
        else if (args.preset === 'autoOrient')
            exprStr = autoOrient(args.presetParams);
        else if (args.preset === 'loopCycle')
            exprStr = loopCycle(args.presetParams);
        else if (args.preset === 'timeRemap')
            exprStr = timeRemap(args.presetParams);
        else if (args.preset === 'random')
            exprStr = random(args.presetParams);
    }
    const script = getCompScript(args.compName) + `
      var layer = comp.layer(${args.layerIndex});
      var prop = layer.property(${JSON.stringify(args.property)});
      if (!prop) prop = layer.property("ADBE Transform Group").property(${JSON.stringify(args.property)});
      if (prop) {
         prop.expression = ${JSON.stringify(exprStr)};
      } else {
         throw new Error("Property not found.");
      }
      'Expression applied.';
    `;
    return executeTool(script);
});
server.tool("create_solid_layer", "Creates a solid layer in the composition", {
    compName: z.string().optional().describe("Target composition name"),
    name: z.string().optional().default('Solid').describe("Layer name"),
    color: z.array(z.number()).optional().default([0, 0, 0]).describe("Solid color [r,g,b] (0-1)"),
    width: z.number().optional().describe("Solid width (defaults to comp width)"),
    height: z.number().optional().describe("Solid height (defaults to comp height)"),
    duration: z.number().optional().describe("Solid duration (defaults to comp duration)")
}, async (args) => {
    const script = getCompScript(args.compName) + `
      var w = ${args.width !== undefined ? args.width : 'comp.width'};
      var h = ${args.height !== undefined ? args.height : 'comp.height'};
      var dur = ${args.duration !== undefined ? args.duration : 'comp.duration'};
      comp.layers.addSolid(${JSON.stringify(args.color)}, ${JSON.stringify(args.name)}, w, h, 1, dur);
      'Solid layer created.';
    `;
    return executeTool(script);
});
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("After Effects MCP server running on stdio");
}
main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
//# sourceMappingURL=index.js.map