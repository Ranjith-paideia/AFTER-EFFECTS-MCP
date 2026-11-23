import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createServer as createHttpServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { runExtendScript, captureFrameToPng } from "./aeBridge.js";
import {
  inertia, wiggle, elasticSpring, staggerDelay, autoOrient,
  audioLink, autoResizeBox, autoResizeBoxPosition, loopCycle,
  timeRemap, random, getAllExpressionNames
} from "./expressions.js";

const server = new McpServer({
  name: "after-effects-mcp",
  version: "1.0.0",
});

interface ToolEnvelope {
  [key: string]: unknown;
  ok: boolean;
  data?: unknown;
  error?: string;
  line?: number;
  requestId?: string;
}

async function executeTool(scriptBody: string): Promise<{
  content: Array<{ type: "text"; text: string }>;
  structuredContent: ToolEnvelope;
  isError: boolean;
}> {
  const raw = await runExtendScript(scriptBody);
  let envelope: ToolEnvelope;
  try {
    envelope = JSON.parse(raw) as ToolEnvelope;
  } catch (error) {
    envelope = {
      ok: false,
      error: "Bridge returned invalid JSON: " + (error instanceof Error ? error.message : String(error)),
    };
  }
  if (!envelope.ok) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
      structuredContent: envelope,
      isError: true,
    };
  }
  return {
    content: [{ type: "text" as const, text: typeof envelope.data === "string"
      ? envelope.data
      : JSON.stringify(envelope.data ?? envelope) }],
    structuredContent: envelope,
    isError: false,
  };
}

const toolOutputSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  line: z.number().optional(),
  requestId: z.string().optional(),
});

function registerCompatTool<T extends z.ZodRawShape>(
  name: string,
  description: string,
  paramsSchema: T,
  cb: (args: z.infer<z.ZodObject<T>>) => Promise<CallToolResult>,
): void {
  const readOnly = name === "get_project_info" ||
    name === "get_composition_info" ||
    name === "list_fonts" ||
    name === "capture_frame_to_png";
  const destructive = !readOnly &&
    name !== "apply_expression" &&
    name !== "apply_text_animator" &&
    name !== "apply_shape_modifiers" &&
    name !== "apply_effect_stack" &&
    name !== "link_property_to_audio" &&
    name !== "animate_transform_with_curves" &&
    name !== "create_motion_path" &&
    name !== "set_track_matte";
  server.registerTool(name, {
    description,
    inputSchema: paramsSchema,
    outputSchema: toolOutputSchema,
    annotations: {
      title: name,
      readOnlyHint: readOnly,
      destructiveHint: destructive,
      idempotentHint: readOnly || name === "set_layer_properties" ||
        name === "set_composition_renderer" ||
        name === "set_track_matte",
      openWorldHint: true,
    },
  }, cb as never);
}

function getCompScript(compName?: string): string {
  if (!compName) return 'var comp = app.project.activeItem;\nif (!(comp instanceof CompItem)) throw new Error("No active composition");\n';
  return 'var comp = null;\nfor (var i = 1; i <= app.project.numItems; i++) {\n  if (app.project.item(i) instanceof CompItem && app.project.item(i).name === ' + JSON.stringify(compName) + ') {\n    comp = app.project.item(i);\n    break;\n  }\n}\nif (!comp) throw new Error("Composition not found: " + ' + JSON.stringify(compName) + ');\n';
}

// ============================================================================
// Suite 1: Timeline, Project & Slate Management
// ============================================================================

registerCompatTool(
  "create_composition",
  "Creates a new composition",
  {
    name: z.string().describe("Name of the composition"),
    width: z.number().optional().default(1920).describe("Width in pixels"),
    height: z.number().optional().default(1080).describe("Height in pixels"),
    fps: z.number().optional().default(29.97).describe("Frames per second"),
    duration: z.number().optional().default(10).describe("Duration in seconds"),
    preset: z.enum(['16:9', '9:16', '1:1', '4:5', '2.39:1']).optional().describe("Aspect ratio preset"),
    bitDepth: z.enum(['8', '16', '32']).optional().default('8').describe("Project color bit depth")
  },
  async (args) => {
    let w = args.width;
    let h = args.height;
    if (args.preset) {
      if (args.preset === '16:9') { w = 1920; h = 1080; }
      else if (args.preset === '9:16') { w = 1080; h = 1920; }
      else if (args.preset === '1:1') { w = 1080; h = 1080; }
      else if (args.preset === '4:5') { w = 1080; h = 1350; }
      else if (args.preset === '2.39:1') { w = 2048; h = 858; }
    }
    const script = `
      var comp = app.project.items.addComp(${JSON.stringify(args.name)}, ${w}, ${h}, 1, ${args.duration}, ${args.fps});
      app.project.bitsPerChannel = parseInt(${JSON.stringify(args.bitDepth)}, 10);
      'Comp created: ' + comp.name;
    `;
    return executeTool(script);
  }
);

registerCompatTool(
  "generate_scene_slate",
  "Generates a production slate with scene, take, and director info",
  {
    scene: z.string().describe("Scene number/name"),
    take: z.string().optional().default('1').describe("Take number"),
    director: z.string().optional().default('').describe("Director name"),
    fps: z.number().optional().default(24).describe("Frames per second"),
    date: z.string().optional().describe("Production date"),
    width: z.number().optional().default(1920).describe("Comp width"),
    height: z.number().optional().default(1080).describe("Comp height")
  },
  async (args) => {
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
  }
);

registerCompatTool(
  "set_timeline_markers",
  "Sets composition timeline markers",
  {
    compName: z.string().optional().describe("Target composition name"),
    markers: z.array(z.object({
      time: z.number().describe("Time in seconds"),
      comment: z.string().describe("Marker comment"),
      color: z.number().optional().describe("Marker color index")
    })).describe("List of markers to add")
  },
  async (args) => {
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
  }
);

registerCompatTool(
  "create_adjustment_layer",
  "Creates an adjustment layer in the composition",
  {
    compName: z.string().optional().describe("Target composition name"),
    name: z.string().optional().default('Adjustment Layer').describe("Layer name"),
    label: z.number().optional().describe("Label color index")
  },
  async (args) => {
    const script = getCompScript(args.compName) + `
      var layer = comp.layers.addSolid([1,1,1], ${JSON.stringify(args.name)}, comp.width, comp.height, 1, comp.duration);
      layer.adjustmentLayer = true;
      if (${args.label !== undefined}) {
        layer.label = ${args.label !== undefined ? args.label : 'layer.label'};
      }
      'Adjustment layer created.';
    `;
    return executeTool(script);
  }
);

// ============================================================================
// Suite 2: Advanced Keyframing, Curves & Easing
// ============================================================================

registerCompatTool(
  "animate_transform_with_curves",
  "Animates a transform property with specified keyframes and easing curves",
  {
    layerIndex: z.number().describe("1-based layer index"),
    property: z.enum(['Position', 'Scale', 'Rotation', 'Opacity', 'Anchor Point']).describe("Transform property"),
    keyframes: z.array(z.object({
      time: z.number(),
      value: z.union([z.number(), z.array(z.number())]),
      easeIn: z.object({ speed: z.number().optional().default(0), influence: z.number().min(0.1).max(100).optional().default(33.33) }).optional(),
      easeOut: z.object({ speed: z.number().optional().default(0), influence: z.number().min(0.1).max(100).optional().default(33.33) }).optional()
    })).describe("Keyframe data"),
    compName: z.string().optional().describe("Target composition name")
  },
  async (args) => {
    const propMap: Record<string, string> = {
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
  }
);

registerCompatTool(
  "separate_position_dimensions",
  "Separates the position dimensions (X, Y, Z) of a layer",
  {
    layerIndex: z.number().describe("1-based layer index"),
    compName: z.string().optional().describe("Target composition name")
  },
  async (args) => {
    const script = getCompScript(args.compName) + `
      comp.layer(${args.layerIndex}).property("ADBE Transform Group").property("ADBE Position").dimensionsSeparated = true;
      'Position dimensions separated.';
    `;
    return executeTool(script);
  }
);

registerCompatTool(
  "create_motion_path",
  "Creates a motion path animation with optional auto-orientation",
  {
    layerIndex: z.number().describe("1-based layer index"),
    points: z.array(z.object({
      time: z.number(),
      x: z.number(),
      y: z.number(),
      z: z.number().optional()
    })).describe("Path points over time"),
    autoOrientToPath: z.boolean().optional().default(false).describe("Orient along path"),
    compName: z.string().optional().describe("Target composition name")
  },
  async (args) => {
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
  }
);

// ============================================================================
// Suite 3: Shape Layers, Vectors & HUD Accents
// ============================================================================

registerCompatTool(
  "create_shape_with_trim_paths",
  "Creates a shape layer with trim paths applied",
  {
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
  },
  async (args) => {
    let shapeMatch = "";
    if (args.shapeType === 'rectangle') shapeMatch = "ADBE Vector Shape - Rect";
    else if (args.shapeType === 'ellipse') shapeMatch = "ADBE Vector Shape - Ellipse";
    else if (args.shapeType === 'star' || args.shapeType === 'polygon') shapeMatch = "ADBE Vector Shape - Star";

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
         shape.property("ADBE Vector Star Outer Radius").setValue(${args.size[0]/2});
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
  }
);

registerCompatTool(
  "generate_shape_repeater",
  "Generates a shape repeater setup",
  {
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
  },
  async (args) => {
    let shapeMatch = "ADBE Vector Shape - Rect";
    if (args.shapeType === 'ellipse') shapeMatch = "ADBE Vector Shape - Ellipse";
    else if (args.shapeType === 'star') shapeMatch = "ADBE Vector Shape - Star";

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
  }
);

registerCompatTool(
  "apply_shape_modifiers",
  "Applies a vector modifier filter to a shape layer",
  {
    layerIndex: z.number().describe("1-based layer index"),
    compName: z.string().optional().describe("Target composition name"),
    modifier: z.enum(['zigzag', 'pucker_bloat', 'offset_paths', 'round_corners']).describe("Modifier type"),
    params: z.record(z.string(), z.number()).optional().describe("Modifier parameters (matchName to value)")
  },
  async (args) => {
    const modMap: Record<string, string> = {
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
  }
);

// ============================================================================
// Suite 4: Kinetic Typography & Subtitles
// ============================================================================

registerCompatTool(
  "create_kinetic_text",
  "Creates styled text for kinetic typography",
  {
    text: z.string().describe("Text content"),
    compName: z.string().optional().describe("Target composition name"),
    font: z.string().optional().default('Arial').describe("Font name"),
    fontSize: z.number().optional().default(72).describe("Font size"),
    tracking: z.number().optional().default(0).describe("Tracking"),
    leading: z.number().optional().describe("Leading"),
    alignment: z.enum(['left', 'center', 'right']).optional().default('center').describe("Paragraph alignment"),
    fauxBold: z.boolean().optional().default(false).describe("Faux bold"),
    allCaps: z.boolean().optional().default(false).describe("All caps"),
    color: z.array(z.number()).optional().default([1,1,1]).describe("Fill color [r,g,b] (0-1)"),
    position: z.array(z.number()).optional().describe("Layer position [x,y]")
  },
  async (args) => {
    const alignMap: Record<string, string> = {
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
  }
);

registerCompatTool(
  "apply_text_animator",
  "Applies a pre-configured text animator preset",
  {
    layerIndex: z.number().describe("1-based layer index of text layer"),
    compName: z.string().optional().describe("Target composition name"),
    preset: z.enum(['typewriter', 'tracking_expander', 'blur_fade', 'elastic_scale', '3d_cascade']).describe("Animator preset"),
    duration: z.number().optional().default(1).describe("Animation duration"),
    stagger: z.number().optional().default(0.05).describe("Stagger time per character")
  },
  async (args) => {
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
  }
);

registerCompatTool(
  "build_auto_resizing_subtitle_box",
  "Builds a text layer with a dynamic auto-resizing background box",
  {
    text: z.string().describe("Subtitle text"),
    compName: z.string().optional().describe("Target composition name"),
    padding: z.array(z.number()).optional().default([20, 10]).describe("Box padding [x, y]"),
    bgColor: z.array(z.number()).optional().default([0, 0, 0]).describe("Background color [r,g,b] (0-1)"),
    bgOpacity: z.number().optional().default(80).describe("Background opacity (0-100)"),
    textColor: z.array(z.number()).optional().default([1, 1, 1]).describe("Text color [r,g,b] (0-1)"),
    font: z.string().optional().default('Arial').describe("Font name"),
    fontSize: z.number().optional().default(48).describe("Font size"),
    yPosition: z.number().optional().describe("Y position for the bottom third")
  },
  async (args) => {
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
  }
);

// ============================================================================
// Suite 5: 3D Systems, Camera Rigs & Hierarchy
// ============================================================================

registerCompatTool(
  "build_master_null_rig",
  "Parents multiple target layers to a newly created Master Null",
  {
    compName: z.string().optional().describe("Target composition name"),
    nullName: z.string().optional().default('Master Null').describe("Name of the null layer"),
    targetLayers: z.array(z.number()).describe("Array of 1-based layer indices to parent"),
    is3D: z.boolean().optional().default(false).describe("Make the null 3D")
  },
  async (args) => {
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
  }
);

registerCompatTool(
  "create_camera_orbit_rig",
  "Creates a camera parented to a 3D null for orbit control",
  {
    compName: z.string().optional().describe("Target composition name"),
    focalLength: z.number().optional().default(50).describe("Camera focal length in mm"),
    depthOfField: z.boolean().optional().default(false).describe("Enable Depth of Field"),
    orbitRadius: z.number().optional().default(500).describe("Distance of camera from null center")
  },
  async (args) => {
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
  }
);

registerCompatTool(
  "add_expression_controllers",
  "Adds expression control effects to a layer",
  {
    layerIndex: z.number().describe("1-based layer index"),
    compName: z.string().optional().describe("Target composition name"),
    controllers: z.array(z.object({
      type: z.enum(['slider', 'angle', 'color', 'point', 'checkbox', 'dropdown']).describe("Control type"),
      name: z.string().describe("Control name")
    })).describe("Controllers to add")
  },
  async (args) => {
    const typeMap: Record<string, string> = {
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
  }
);

// ============================================================================
// Suite 6: VFX, Transitions & Effect Parade
// ============================================================================

registerCompatTool(
  "apply_effect_stack",
  "Applies a stack of effects with optional parameters to a layer",
  {
    layerIndex: z.number().describe("1-based layer index"),
    compName: z.string().optional().describe("Target composition name"),
    effects: z.array(z.object({
      matchName: z.string().describe("Effect matchName (e.g. ADBE Gaussian Blur 2)"),
      params: z.record(z.string(), z.union([z.number(), z.string(), z.array(z.number()), z.boolean()])).optional().describe("Property matchName to value map")
    })).describe("Effects stack to apply")
  },
  async (args) => {
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
  }
);

registerCompatTool(
  "create_displacement_glitch",
  "Creates a procedural glitch effect using displacement maps",
  {
    layerIndex: z.number().describe("1-based target layer index"),
    compName: z.string().optional().describe("Target composition name"),
    intensity: z.number().optional().default(50).describe("Max displacement intensity"),
    speed: z.number().optional().default(10).describe("Glitch evolution speed"),
    duration: z.number().optional().describe("Duration of the noise map layer")
  },
  async (args) => {
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
  }
);

registerCompatTool(
  "create_gradient_light_leak",
  "Generates a gradient ramp light leak layer",
  {
    compName: z.string().optional().describe("Target composition name"),
    color1: z.array(z.number()).optional().default([1, 0.8, 0.2]).describe("Start color [r,g,b] (0-1)"),
    color2: z.array(z.number()).optional().default([1, 0.2, 0.1]).describe("End color [r,g,b] (0-1)"),
    blendMode: z.enum(['screen', 'add', 'overlay']).optional().default('screen').describe("Blending mode"),
    opacity: z.number().optional().default(70).describe("Max opacity")
  },
  async (args) => {
    const blendMap: Record<string, string> = {
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
  }
);

// ============================================================================
// Suite 7: Audio Reactivity & Automation
// ============================================================================

registerCompatTool(
  "convert_audio_to_keyframes",
  "Runs 'Convert Audio to Keyframes' command on an audio layer",
  {
    audioLayerIndex: z.number().describe("1-based index of the audio layer"),
    compName: z.string().optional().describe("Target composition name")
  },
  async (args) => {
    const script = getCompScript(args.compName) + `
      for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
      comp.layer(${args.audioLayerIndex}).selected = true;
      app.executeCommand(app.findMenuCommandId("Convert Audio to Keyframes"));
      'Audio converted to keyframes.';
    `;
    return executeTool(script);
  }
);

registerCompatTool(
  "link_property_to_audio",
  "Links a property to audio keyframes using expressions",
  {
    targetLayerIndex: z.number().describe("1-based index of target layer"),
    property: z.string().describe("Property matchName to link"),
    audioLayerIndex: z.number().optional().default(1).describe("1-based index of Audio Amplitude layer"),
    minVal: z.number().optional().default(0).describe("Minimum output value"),
    maxVal: z.number().optional().default(100).describe("Maximum output value"),
    channel: z.enum(['left', 'right', 'both']).optional().default('both').describe("Audio channel"),
    compName: z.string().optional().describe("Target composition name")
  },
  async (args) => {
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
  }
);

// ============================================================================
// Suite 8: Render Queue & Raw Execution
// ============================================================================

registerCompatTool(
  "add_to_render_queue",
  "Adds a composition to the Render Queue",
  {
    compName: z.string().optional().describe("Target composition name (defaults to active item)"),
    outputPath: z.string().describe("Absolute file path for output render"),
    template: z.string().optional().describe("Output Module Template name")
  },
  async (args) => {
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
  }
);

registerCompatTool(
  "execute_extendscript",
  "Executes raw ExtendScript code directly. Use this as an escape hatch for arbitrary logic.",
  {
    script: z.string().describe("Raw ExtendScript code string to execute")
  },
  async (args) => {
    if (process.env.AE_DISABLE_RAW_SCRIPT === "1") {
      const envelope: ToolEnvelope = { ok: false, error: "Raw ExtendScript execution is disabled by AE_DISABLE_RAW_SCRIPT=1" };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope,
        isError: true,
      };
    }
    return executeTool(args.script);
  }
);

registerCompatTool(
  "execute_raw_extendscript",
  "Compatibility alias for execute_extendscript.",
  {
    script: z.string().describe("Raw ExtendScript code string to execute")
  },
  async (args) => {
    if (process.env.AE_DISABLE_RAW_SCRIPT === "1") {
      const envelope: ToolEnvelope = { ok: false, error: "Raw ExtendScript execution is disabled by AE_DISABLE_RAW_SCRIPT=1" };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope,
        isError: true,
      };
    }
    return executeTool(args.script);
  }
);

// ============================================================================
// Suite X: Additional Tools
// ============================================================================

registerCompatTool(
  "get_project_info",
  "Gets basic information about the active project",
  {},
  async () => {
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
  }
);

registerCompatTool(
  "get_composition_info",
  "Gets detailed information about a composition",
  {
    compName: z.string().optional().describe("Composition name (defaults to active)")
  },
  async (args) => {
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
  }
);

registerCompatTool(
  "list_fonts",
  "Lists available After Effects fonts using app.fonts.allFonts",
  {
    search: z.string().optional().describe("Case-insensitive family, style, or PostScript name filter"),
    limit: z.number().optional().default(50).describe("Maximum results (1-500)")
  },
  async (args) => {
    const script = `
      var limit = ${JSON.stringify(args.limit)};
      if (limit < 1) limit = 1;
      if (limit > 500) limit = 500;
      var search = ${JSON.stringify(args.search || "")}.toLowerCase();
      var fonts = [];
      if (typeof app.fonts !== "undefined" && app.fonts.allFonts) {
        var families = app.fonts.allFonts;
        for (var i = 0; i < families.length && fonts.length < limit; i++) {
          for (var j = 0; j < families[i].length && fonts.length < limit; j++) {
            var f = families[i][j];
            var familyName = f.familyName ? f.familyName : "";
            var styleName = f.styleName ? f.styleName : "";
            var postScriptName = f.postScriptName ? f.postScriptName : "";
            var haystack = (familyName + " " + styleName + " " + postScriptName).toLowerCase();
            if (!search || haystack.indexOf(search) !== -1) {
              fonts.push({
                familyName: familyName,
                styleName: styleName,
                postScriptName: postScriptName
              });
            }
          }
        }
      }
      JSON.stringify({ fonts: fonts, count: fonts.length });
    `;
    return executeTool(script);
  }
);

registerCompatTool(
  "set_composition_renderer",
  "Sets the composition 3D renderer to a verified AE 2024 matchName",
  {
    compName: z.string().optional(),
    renderer: z.enum(["classic_3d", "advanced_3d", "cinema_4d"]).describe("Friendly renderer name")
  },
  async (args) => {
    const script = getCompScript(args.compName) + `
      var targetMap = {
        classic_3d: "ADBE Advanced 3d",
        advanced_3d: "ADBE Calder",
        cinema_4d: "ADBE Ernst"
      };
      var target = targetMap[` + JSON.stringify(args.renderer) + `];
      var found = false;
      for (var i = 0; i < comp.renderers.length; i++) {
        if (comp.renderers[i] === target) found = true;
      }
      if (!found) throw new Error("Renderer matchName is unavailable: " + target);
      comp.renderer = target;
      JSON.stringify({ renderer: ` + JSON.stringify(args.renderer) + `, matchName: target });
    `;
    return executeTool(script);
  }
);

registerCompatTool(
  "set_track_matte",
  "Sets or removes a track matte on a fill AVLayer",
  {
    compName: z.string().optional(),
    fillLayerIndex: z.number().describe("1-based fill AVLayer index"),
    matteLayerIndex: z.number().optional().describe("1-based matte AVLayer index"),
    type: z.enum(["ALPHA", "ALPHA_INVERTED", "LUMA", "LUMA_INVERTED"]).optional().default("ALPHA"),
    remove: z.boolean().optional().default(false)
  },
  async (args) => {
    const script = getCompScript(args.compName) + `
      var fill = comp.layer(${JSON.stringify(args.fillLayerIndex)});
      if (!(fill instanceof AVLayer)) throw new Error("Fill layer is not an AVLayer");
      if (${JSON.stringify(args.remove)}) {
        fill.removeTrackMatte();
      } else {
        if (${args.matteLayerIndex === undefined ? "true" : "false"}) throw new Error("matteLayerIndex is required unless remove=true");
        var matte = comp.layer(${JSON.stringify(args.matteLayerIndex)});
        if (!(matte instanceof AVLayer)) throw new Error("Matte layer is not an AVLayer");
        var typeMap = {
          ALPHA: TrackMatteType.ALPHA,
          ALPHA_INVERTED: TrackMatteType.ALPHA_INVERTED,
          LUMA: TrackMatteType.LUMA,
          LUMA_INVERTED: TrackMatteType.LUMA_INVERTED
        };
        fill.setTrackMatte(matte, typeMap[${JSON.stringify(args.type)}]);
      }
      JSON.stringify({
        fillLayerIndex: fill.index,
        matteLayerIndex: fill.trackMatteLayer ? fill.trackMatteLayer.index : null,
        trackMatteType: fill.trackMatteType
      });
    `;
    return executeTool(script);
  }
);

registerCompatTool(
  "capture_frame_to_png",
  "Captures a composition frame as a validated native MCP PNG image",
  {
    compName: z.string().optional(),
    time: z.number().describe("Time in seconds")
  },
  async (args) => {
    const captured = await captureFrameToPng(args.compName, args.time);
    if (!captured.ok) {
      const envelope: ToolEnvelope = { ok: false, error: captured.error };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(envelope) }],
        structuredContent: envelope,
        isError: true,
      };
    }
    const envelope: ToolEnvelope = { ok: true, data: { mimeType: "image/png" } };
    return {
      content: [{ type: "image" as const, data: captured.base64, mimeType: "image/png" }],
      structuredContent: envelope,
      isError: false,
    };
  }
);

registerCompatTool(
  "set_layer_properties",
  "Sets standard properties on a layer",
  {
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
  },
  async (args) => {
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
      if (props.blendingMode !== undefined) {
         var blendMap = {
           normal: BlendingMode.NORMAL,
           screen: BlendingMode.SCREEN,
           add: BlendingMode.ADD,
           overlay: BlendingMode.OVERLAY,
           multiply: BlendingMode.MULTIPLY,
           dissolve: BlendingMode.DISSOLVE,
           darken: BlendingMode.DARKEN,
           lighten: BlendingMode.LIGHTEN,
           difference: BlendingMode.DIFFERENCE
         };
         var blendKey = String(props.blendingMode).toLowerCase();
         if (blendMap[blendKey] !== undefined) layer.blendingMode = blendMap[blendKey];
         else throw new Error("Unsupported blending mode: " + props.blendingMode);
      }
      'Layer properties updated.';
    `;
    return executeTool(script);
  }
);

registerCompatTool(
  "duplicate_layer",
  "Duplicates a layer in the composition one or more times",
  {
    layerIndex: z.number().describe("1-based layer index"),
    compName: z.string().optional().describe("Target composition name"),
    count: z.number().optional().default(1).describe("Number of duplicates to create")
  },
  async (args) => {
    const script = getCompScript(args.compName) + `
      var layer = comp.layer(${args.layerIndex});
      var count = ${args.count};
      for (var i = 0; i < count; i++) {
         layer.duplicate();
      }
      'Layer duplicated ' + count + ' times.';
    `;
    return executeTool(script);
  }
);

registerCompatTool(
  "delete_layer",
  "Deletes a layer from the composition",
  {
    layerIndex: z.number().describe("1-based layer index"),
    compName: z.string().optional().describe("Target composition name")
  },
  async (args) => {
    const script = getCompScript(args.compName) + `
      comp.layer(${args.layerIndex}).remove();
      'Layer deleted.';
    `;
    return executeTool(script);
  }
);

registerCompatTool(
  "apply_expression",
  "Applies an expression string or preset to a property",
  {
    layerIndex: z.number().describe("1-based layer index"),
    property: z.string().describe("Property path/matchName"),
    expression: z.string().describe("Raw expression string (used if preset is omitted)"),
    preset: z.string().optional().describe("Expression preset name (inertia, wiggle, etc.)"),
    presetParams: z.record(z.string(), z.any()).optional().describe("Parameters for the preset function"),
    compName: z.string().optional().describe("Target composition name")
  },
  async (args) => {
    let exprStr = args.expression;
    if (args.preset) {
       if (args.preset === 'inertia') exprStr = inertia(args.presetParams as any);
       else if (args.preset === 'wiggle') exprStr = wiggle(args.presetParams as any);
       else if (args.preset === 'elasticSpring') exprStr = elasticSpring(args.presetParams as any);
       else if (args.preset === 'staggerDelay') exprStr = staggerDelay(args.presetParams as any);
       else if (args.preset === 'autoOrient') exprStr = autoOrient(args.presetParams as any);
       else if (args.preset === 'loopCycle') exprStr = loopCycle(args.presetParams as any);
       else if (args.preset === 'timeRemap') exprStr = timeRemap(args.presetParams as any);
       else if (args.preset === 'random') exprStr = random(args.presetParams as any);
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
  }
);

registerCompatTool(
  "create_solid_layer",
  "Creates a solid layer in the composition",
  {
    compName: z.string().optional().describe("Target composition name"),
    name: z.string().optional().default('Solid').describe("Layer name"),
    color: z.array(z.number()).optional().default([0,0,0]).describe("Solid color [r,g,b] (0-1)"),
    width: z.number().optional().describe("Solid width (defaults to comp width)"),
    height: z.number().optional().describe("Solid height (defaults to comp height)"),
    duration: z.number().optional().describe("Solid duration (defaults to comp duration)")
  },
  async (args) => {
    const script = getCompScript(args.compName) + `
      var w = ${args.width !== undefined ? args.width : 'comp.width'};
      var h = ${args.height !== undefined ? args.height : 'comp.height'};
      var dur = ${args.duration !== undefined ? args.duration : 'comp.duration'};
      comp.layers.addSolid(${JSON.stringify(args.color)}, ${JSON.stringify(args.name)}, w, h, 1, dur);
      'Solid layer created.';
    `;
    return executeTool(script);
  }
);

registerCompatTool(
  "center_anchor_on_source_rect",
  "Centers a text or shape layer anchor point without moving the layer on screen",
  {
    compName: z.string().optional(),
    layerIndex: z.number().describe("1-based layer index"),
    time: z.number().optional().default(0)
  },
  async (args) => {
    const script = getCompScript(args.compName) + `
      var layer = comp.layer(${JSON.stringify(args.layerIndex)});
      var transform = layer.property("ADBE Transform Group");
      var anchor = transform.property("ADBE Anchor Point");
      var position = transform.property("ADBE Position");
      var rect = layer.sourceRectAtTime(${JSON.stringify(args.time)}, false);
      var newAnchor = [rect.left + rect.width / 2, rect.top + rect.height / 2];
      var oldAnchor = anchor.value;
      var oldPosition = position.value;
      var delta = [
        newAnchor[0] - oldAnchor[0],
        newAnchor[1] - oldAnchor[1]
      ];
      var scaleProp = transform.property("ADBE Scale");
      var scale = scaleProp ? scaleProp.value : [100, 100];
      var localDx = delta[0] * scale[0] / 100;
      var localDy = delta[1] * scale[1] / 100;
      var rotationProp = transform.property("ADBE Rotation");
      var angle = rotationProp ? rotationProp.value * Math.PI / 180 : 0;
      var worldDx = localDx * Math.cos(angle) - localDy * Math.sin(angle);
      var worldDy = localDx * Math.sin(angle) + localDy * Math.cos(angle);
      anchor.setValue(newAnchor);
      if (oldPosition.length === 2) {
        position.setValue([oldPosition[0] + worldDx, oldPosition[1] + worldDy]);
      } else {
        position.setValue([oldPosition[0] + worldDx, oldPosition[1] + worldDy, oldPosition[2]]);
      }
      JSON.stringify({ anchor: newAnchor, position: position.value, sourceRect: rect });
    `;
    return executeTool(script);
  }
);

server.registerResource(
  "ae-project",
  "ae://project",
  {
    title: "Active After Effects Project",
    description: "Basic active-project state.",
    mimeType: "application/json",
  },
  async () => {
    const result = await executeTool(`
      var p = app.project;
      var res = {
        name: p.file ? p.file.name : "Untitled",
        path: p.file ? p.file.fsName : "Unsaved",
        numItems: p.numItems,
        activeItem: p.activeItem ? p.activeItem.name : "None",
        aeVersion: app.version,
        bitsPerChannel: p.bitsPerChannel
      };
      JSON.stringify(res);
    `);
    return { contents: [{ uri: "ae://project", mimeType: "application/json", text: result.content[0].text }] };
  },
);

server.registerResource(
  "ae-active-composition",
  "ae://active-composition",
  {
    title: "Active Composition",
    description: "Name, dimensions, frame rate, duration, renderer, and layers.",
    mimeType: "application/json",
  },
  async () => {
    const result = await executeTool(`
      var comp = app.project.activeItem;
      if (!(comp instanceof CompItem)) throw new Error("No active composition");
      var layers = [];
      for (var i = 1; i <= comp.numLayers; i++) {
        var layer = comp.layer(i);
        layers.push({ name: layer.name, index: layer.index, type: layer instanceof AVLayer ? "AVLayer" : "Layer" });
      }
      JSON.stringify({
        name: comp.name,
        width: comp.width,
        height: comp.height,
        fps: comp.frameRate,
        duration: comp.duration,
        renderer: comp.renderer,
        numLayers: comp.numLayers,
        layers: layers
      });
    `);
    return { contents: [{ uri: "ae://active-composition", mimeType: "application/json", text: result.content[0].text }] };
  },
);

server.registerResource(
  "ae-rules",
  "ae://rules/2024",
  {
    title: "After Effects 2024 MCP Rules",
    description: "Verified runtime, matchName, renderer, and bridge rules.",
    mimeType: "text/markdown",
  },
  async () => ({
    contents: [{
      uri: "ae://rules/2024",
      mimeType: "text/markdown",
      text: [
        "# After Effects 2024",
        "- Use ExtendScript ES3 syntax only.",
        "- Address properties by matchName.",
        '- Renderers: classic_3d="ADBE Advanced 3d", advanced_3d="ADBE Calder", cinema_4d="ADBE Ernst".',
        "- Project bit depth is app.project.bitsPerChannel.",
        "- saveFrameToPng is asynchronous; Node.js validates the complete PNG.",
      ].join("\n"),
    }],
  }),
);

server.registerPrompt(
  "ae2024-production-workflow",
  {
    title: "AE 2024 Production Workflow",
    description: "Guidance for safe, studio-grade AE 2024 automation.",
    argsSchema: {
      goal: z.string().describe("Requested motion graphics or editing outcome"),
    },
  },
  async (args) => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text:
          "Use After Effects 2024 APIs and matchNames. Validate targets before mutation. " +
          "Keep changes in one undo group. Return structured errors. Goal: " + args.goal,
      },
    }],
  }),
);

async function main() {
  const httpPortText = process.env.AE_MCP_HTTP_PORT;
  if (httpPortText) {
    const port = Number(httpPortText);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("AE_MCP_HTTP_PORT must be an integer between 1 and 65535");
    }
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: true,
    });
    await server.connect(transport);
    const httpServer = createHttpServer(async (req: IncomingMessage, res: ServerResponse) => {
      if (req.url !== "/mcp") {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ ok: false, error: "Not found" }));
        return;
      }
      if (req.method !== "POST" && req.method !== "GET" && req.method !== "DELETE") {
        res.statusCode = 405;
        res.setHeader("Allow", "GET, POST, DELETE");
        res.end();
        return;
      }
      let parsedBody: unknown;
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        try {
          parsedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch (error) {
          res.statusCode = 400;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ ok: false, error: "Invalid JSON body" }));
          return;
        }
      }
      await transport.handleRequest(req, res, parsedBody);
    });
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(port, "127.0.0.1", () => resolve());
    });
    console.error("After Effects MCP server running on Streamable HTTP at http://127.0.0.1:" + port + "/mcp");
  } else {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("After Effects MCP server running on stdio");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
