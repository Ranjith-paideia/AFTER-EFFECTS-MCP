import { execFileSync } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export interface BridgeEnvelope {
  ok: boolean;
  data?: unknown;
  error?: string;
  line?: number;
  requestId?: string;
}

const JSON_POLYFILL = [
  'var JSON = JSON || {};',
  'if (typeof JSON.stringify !== "function") {',
  '  JSON.stringify = function(obj) {',
  '    var t = typeof(obj);',
  '    if (obj === null) return "null";',
  '    if (t == "string") return "\\"" + obj.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, "\\\\\\"").replace(/\\b/g, "\\\\b").replace(/\\f/g, "\\\\f").replace(/\\n/g, "\\\\n").replace(/\\r/g, "\\\\r").replace(/\\t/g, "\\\\t") + "\\"";',
  '    if (t == "number" || t == "boolean") return String(obj);',
  '    if (t == "undefined" || typeof obj == "function") return "null";',
  '    if (obj instanceof Array) {',
  '      var arr = [];',
  '      for (var i = 0; i < obj.length; i++) arr.push(JSON.stringify(obj[i]) === "null" ? "null" : JSON.stringify(obj[i]));',
  '      return "[" + arr.join(",") + "]";',
  '    }',
  '    var parts = [];',
  '    for (var key in obj) {',
  '      if (obj.hasOwnProperty(key)) {',
  '        var value = JSON.stringify(obj[key]);',
  '        if (value !== "null" || typeof obj[key] != "undefined") parts.push(JSON.stringify(key) + ":" + value);',
  '      }',
  '    }',
  '    return "{" + parts.join(",") + "}";',
  '  };',
  '}',
].join('\n');

export function escapeForAppleScript(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n/g, '\\n')
    .replace(/\r/g, '\\n')
    .replace(/\n/g, '\\n');
}

export function escapeForVBS(str: string): string {
  return str.replace(/"/g, '""');
}

export function buildScript(userScript: string, resultPath: string, requestId: string): string {
  const resultPathJson = JSON.stringify(resultPath);
  const requestIdJson = JSON.stringify(requestId);
  const lines = [
    JSON_POLYFILL,
    'var __mcp_result;',
    'try {',
    '  app.beginUndoGroup("MCP Action");',
    '  var __mcp_user_func = function() {',
    '    ' + userScript.split('\n').join('\n    '),
    '  };',
    '  var __mcp_data = __mcp_user_func();',
    '  __mcp_result = JSON.stringify({ ok: true, data: __mcp_data, requestId: ' + requestIdJson + ' });',
    '} catch(e) {',
    '  var __mcp_message = e && e.toString ? e.toString() : String(e);',
    '  var __mcp_line = 0;',
    '  if (e && typeof e.line === "number") __mcp_line = e.line;',
    '  __mcp_result = JSON.stringify({ ok: false, error: __mcp_message, line: __mcp_line, requestId: ' + requestIdJson + ' });',
    '} finally {',
    '  try { app.endUndoGroup(); } catch(e2) {}',
    '}',
    'var __mcp_file = new File(' + resultPathJson + ');',
    'var __mcp_opened = __mcp_file.open("w");',
    'if (__mcp_opened) {',
    '  __mcp_file.encoding = "UTF-8";',
    '  __mcp_file.write(__mcp_result);',
    '  __mcp_file.close();',
    '}',
  ];
  return lines.join('\n');
}

async function waitForResultFile(resultPath: string, timeoutMs: number): Promise<BridgeEnvelope> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const text = await fsPromises.readFile(resultPath, 'utf8');
      if (text.length > 0) {
        const parsed = JSON.parse(text) as BridgeEnvelope;
        if (typeof parsed.ok === 'boolean') return parsed;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'EBUSY' && code !== 'EPERM') {
        throw error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return {
    ok: false,
    error: 'After Effects did not write a valid atomic result file before timeout',
  };
}

function findAfterFxExecutable(): string | undefined {
  try {
    const output = execFileSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      '(Get-Process -Name AfterFX -ErrorAction SilentlyContinue).Path',
    ], { encoding: 'utf8', timeout: 5000 }).trim();
    if (output && fs.existsSync(output)) return output.split(/\r?\n/)[0];
  } catch (_) {}

  const candidates = [
    'C:\\Program Files\\Adobe\\Adobe After Effects 2024\\Support Files\\AfterFX.exe',
    'D:\\after effects\\Adobe After Effects 2024\\Support Files\\AfterFX.exe',
    'C:\\Program Files\\Adobe\\Adobe After Effects 2025\\Support Files\\AfterFX.exe',
    'C:\\Program Files\\Adobe\\Adobe After Effects 2023\\Support Files\\AfterFX.exe',
  ];
  for (let i = 0; i < candidates.length; i++) {
    if (fs.existsSync(candidates[i])) return candidates[i];
  }
  return undefined;
}

async function cleanupFile(filePath: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await fsPromises.unlink(filePath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      if (code !== 'EBUSY' && code !== 'EPERM') return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

export async function runExtendScript(
  script: string,
  timeoutMs: number = 30000,
): Promise<string> {
  const requestId = crypto.randomUUID();
  const tmpDir = os.tmpdir();
  const id = crypto.randomUUID();
  const jsxPath = path.join(tmpDir, 'ae_mcp_' + id + '.jsx');
  const resultPath = path.join(tmpDir, 'ae_mcp_' + id + '.result.json');
  const vbsPath = path.join(tmpDir, 'ae_mcp_' + id + '.vbs');
  const fullScript = buildScript(script, resultPath, requestId);
  let envelope: BridgeEnvelope = { ok: false, error: 'No execution path completed', requestId };

  try {
    await fsPromises.writeFile(jsxPath, fullScript, 'utf8');

    if (process.platform === 'win32') {
      const jsxPathVBS = escapeForVBS(jsxPath);
      const vbsCode = [
        'Dim AEApp',
        'On Error Resume Next',
        'Set AEApp = GetObject(, "AfterEffects.Application.24")',
        'If AEApp Is Nothing Then Set AEApp = GetObject(, "AfterEffects.Application")',
        'If AEApp Is Nothing Then Set AEApp = CreateObject("AfterEffects.Application")',
        'On Error GoTo 0',
        'If AEApp Is Nothing Then',
        '  WScript.StdErr.Write "Failed to connect to After Effects via COM"',
        '  WScript.Quit 1',
        'End If',
        'Dim result',
        'result = AEApp.DoScriptFile("' + jsxPathVBS + '")',
        'WScript.StdOut.Write result',
      ].join('\r\n');
      await fsPromises.writeFile(vbsPath, vbsCode, 'utf8');

      let comAttemptSucceeded = false;
      try {
        execFileSync('cscript.exe', ['//NoLogo', vbsPath], {
          timeout: timeoutMs,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        comAttemptSucceeded = true;
      } catch (error) {
        console.error('[aeBridge] Windows COM execution unavailable:', error instanceof Error ? error.message : String(error));
      }

      if (comAttemptSucceeded) {
        envelope = await waitForResultFile(resultPath, timeoutMs);
      }
      if (!comAttemptSucceeded || (envelope && !envelope.ok && envelope.error && envelope.error.indexOf('did not write') !== -1)) {
        await cleanupFile(resultPath);
        const aeExePath = findAfterFxExecutable();
        if (!aeExePath) {
          envelope = { ok: false, error: 'After Effects executable (AfterFX.exe) was not found', requestId };
        } else {
          try {
            execFileSync(aeExePath, ['-r', jsxPath], {
              timeout: timeoutMs,
              encoding: 'utf8',
              stdio: ['ignore', 'pipe', 'pipe'],
            });
            envelope = await waitForResultFile(resultPath, timeoutMs);
          } catch (error) {
            envelope = {
              ok: false,
              error: 'AfterFX.exe execution failed: ' + (error instanceof Error ? error.message : String(error)),
              requestId,
            };
          }
        }
      }
    } else if (process.platform === 'darwin') {
      const escapedScript = escapeForAppleScript(fullScript);
      const osaCommand = 'tell application id "com.adobe.aftereffects" to DoScript "' + escapedScript + '"';
      try {
        execFileSync('osascript', ['-e', osaCommand], {
          timeout: timeoutMs,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        envelope = await waitForResultFile(resultPath, timeoutMs);
      } catch (error) {
        envelope = {
          ok: false,
          error: 'macOS osascript execution failed: ' + (error instanceof Error ? error.message : String(error)),
          requestId,
        };
      }
    } else {
      envelope = { ok: false, error: 'Unsupported platform: ' + process.platform, requestId };
    }
  } catch (error) {
    envelope = {
      ok: false,
      error: 'Bridge setup failed: ' + (error instanceof Error ? error.message : String(error)),
      requestId,
    };
  } finally {
    await cleanupFile(jsxPath);
    await cleanupFile(vbsPath);
    await cleanupFile(resultPath);
  }

  return JSON.stringify(envelope);
}

async function pollPngFile(
  pngPath: string,
  timeoutMs: number,
): Promise<{ ok: true; data: Buffer } | { ok: false; error: string }> {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const trailer = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  const deadline = Date.now() + timeoutMs;
  let previousSize = -1;

  while (Date.now() < deadline) {
    try {
      const data = await fsPromises.readFile(pngPath);
      if (data.length > 64 && data.subarray(0, 8).equals(signature)) {
        const endsWithTrailer = data.length >= trailer.length &&
          data.subarray(data.length - trailer.length).equals(trailer);
        if (endsWithTrailer && data.length === previousSize) {
          return { ok: true, data };
        }
        previousSize = data.length;
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'EBUSY' && code !== 'EPERM') {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return { ok: false, error: 'PNG frame did not become complete and stable before timeout' };
}

export async function captureFrameToPng(
  compName: string | undefined,
  timeInSeconds: number,
  timeoutMs: number = 30000,
): Promise<{ ok: true; base64: string } | { ok: false; error: string }> {
  const id = crypto.randomUUID();
  const pngPath = path.join(os.tmpdir(), 'ae_mcp_frame_' + id + '.png');
  const compSelection = compName
    ? 'var comp = null;\nfor (var i = 1; i <= app.project.numItems; i++) {\n  if (app.project.item(i) instanceof CompItem && app.project.item(i).name === ' + JSON.stringify(compName) + ') { comp = app.project.item(i); break; }\n}\nif (!comp) throw new Error("Composition not found: " + ' + JSON.stringify(compName) + ');'
    : 'var comp = app.project.activeItem;\nif (!(comp instanceof CompItem)) throw new Error("No active composition");';
  const script =
    compSelection +
    '\ncomp.saveFrameToPng(' + JSON.stringify(timeInSeconds) + ', new File(' + JSON.stringify(pngPath) + '));\n' +
    JSON.stringify(pngPath) + ';';
  const raw = await runExtendScript(script, timeoutMs);
  let bridge: BridgeEnvelope;
  try {
    bridge = JSON.parse(raw) as BridgeEnvelope;
  } catch (error) {
    return { ok: false, error: 'Bridge returned invalid JSON: ' + (error instanceof Error ? error.message : String(error)) };
  }
  if (!bridge.ok) return { ok: false, error: bridge.error || 'ExtendScript frame capture failed' };

  const poll = await pollPngFile(pngPath, timeoutMs);
  if (!poll.ok) {
    await cleanupFile(pngPath);
    return poll;
  }
  const base64 = poll.data.toString('base64');
  await cleanupFile(pngPath);
  return { ok: true, base64 };
}
