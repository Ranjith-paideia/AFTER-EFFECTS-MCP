import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/**
 * Inline JSON polyfill for ExtendScript's ES3 engine (no native JSON).
 * Provides __json_stringify and __json_parse for structured result envelopes.
 */
const JSON_POLYFILL = [
  'function __json_stringify(obj) {',
  '  var t = typeof(obj);',
  '  if (t != "object" || obj === null) {',
  '    if (t == "string") {',
  '      obj = \'"\' + obj.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, \'\\\\"\').replace(/\\n/g, "\\\\n").replace(/\\r/g, "\\\\r").replace(/\\t/g, "\\\\t") + \'"\';',
  '    }',
  '    return String(obj);',
  '  } else {',
  '    var n, v, json = [], arr = (obj && obj.constructor == Array);',
  '    for (n in obj) {',
  '      if (obj.hasOwnProperty(n)) {',
  '        v = obj[n];',
  '        t = typeof(v);',
  '        if (t == "string") v = \'"\' + v.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, \'\\\\"\').replace(/\\n/g, "\\\\n").replace(/\\r/g, "\\\\r").replace(/\\t/g, "\\\\t") + \'"\';',
  '        else if (t == "object" && v !== null) v = __json_stringify(v);',
  '        else if (t == "undefined") continue;',
  '        json.push((arr ? "" : \'"\' + n + \'":\'  ) + String(v));',
  '      }',
  '    }',
  '    return (arr ? "[" : "{") + String(json) + (arr ? "]" : "}");',
  '  }',
  '}',
  'function __json_parse(str) {',
  '  if (str === "") str = \'""\'  ;',
  '  eval("var __json_p=" + str + ";");',
  '  return __json_p;',
  '}',
].join('\n');

/**
 * Escapes a string for safe embedding inside AppleScript string literals.
 * @param str The string to escape.
 * @returns The escaped string.
 */
export function escapeForAppleScript(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n/g, '\\n')
    .replace(/\r/g, '\\n')
    .replace(/\n/g, '\\n');
}

/**
 * Escapes a string for safe embedding inside VBScript string literals.
 * Doubles all double-quote characters.
 * @param str The string to escape.
 * @returns The escaped string.
 */
export function escapeForVBS(str: string): string {
  return str.replace(/"/g, '""');
}

/**
 * Builds the complete ExtendScript payload by combining the JSON polyfill,
 * undo group wrapper, try/catch error envelope, and the user's script.
 * @param userScript The raw ExtendScript code to execute.
 * @returns The full wrapped ExtendScript payload string.
 */
export function buildScript(userScript: string): string {
  const lines = [
    JSON_POLYFILL,
    'var __mcp_result;',
    'try {',
    '  app.beginUndoGroup("MCP Action");',
    '  var __mcp_user_func = function() {',
    '    ' + userScript.split('\n').join('\n    '),
    '  };',
    '  var __mcp_ret = __mcp_user_func();',
    '  app.endUndoGroup();',
    '  __mcp_result = __json_stringify({ success: true, result: __mcp_ret });',
    '} catch(e) {',
    '  try { app.endUndoGroup(); } catch(e2) {}',
    '  __mcp_result = __json_stringify({ success: false, error: e.toString() });',
    '}',
    '__mcp_result;',
  ];
  return lines.join('\n');
}

/**
 * Executes ExtendScript in Adobe After Effects via cross-platform IPC.
 *
 * - **Windows**: Writes a temp .jsx and .vbs file, executes via cscript COM bridge.
 * - **macOS**: Dispatches via osascript AppleScript to After Effects DoScript.
 *
 * All payloads are wrapped with JSON polyfill, undo group, and error envelope.
 *
 * @param script The ExtendScript code to execute.
 * @param timeoutMs Execution timeout in milliseconds (default: 30000).
 * @returns A promise resolving with the JSON-serialized result string.
 */
export async function runExtendScript(
  script: string,
  timeoutMs: number = 30000,
): Promise<string> {
  const fullScript = buildScript(script);
  const platform = os.platform();
  let rawOutput = '';

  if (platform === 'win32') {
    const id = crypto.randomUUID();
    const tmpDir = os.tmpdir();
    const jsxPath = path.join(tmpDir, 'ae_mcp_' + id + '.jsx');
    const vbsPath = path.join(tmpDir, 'ae_mcp_' + id + '.vbs');

    // Track which execution path was used so cleanup can be adjusted
    let usedAfterFXExe = false;

    try {
      fs.writeFileSync(jsxPath, fullScript, 'utf8');

      // Attempt 1: VBScript COM automation
      let comSuccess = false;
      try {
        // Use DoScriptFile with the .jsx file path (already written to disk).
        // VBS cannot embed multi-line strings, so inline DoScript is not viable.
        const jsxPathVBS = escapeForVBS(jsxPath);
        const vbsCode = [
          'Dim AEApp',
          'On Error Resume Next',
          // Try versioned ProgIDs for AE 2025/2024, then generic
          'Set AEApp = GetObject(, "AfterEffects.Application.25")',
          'If AEApp Is Nothing Then Set AEApp = GetObject(, "AfterEffects.Application.24")',
          'If AEApp Is Nothing Then Set AEApp = GetObject(, "AfterEffects.Application")',
          'If AEApp Is Nothing Then Set AEApp = CreateObject("AfterEffects.Application")',
          'On Error GoTo 0',
          'If AEApp Is Nothing Then',
          '    WScript.StdErr.Write "Failed to connect to After Effects via COM"',
          '    WScript.Quit 1',
          'End If',
          'Dim result',
          // DoScriptFile runs a .jsx file — correct COM API for script files
          'result = AEApp.DoScriptFile("' + jsxPathVBS + '")',
          'WScript.StdOut.Write result',
        ].join('\r\n');

        fs.writeFileSync(vbsPath, vbsCode, 'utf8');

        const outputBuffer = execSync('cscript //NoLogo "' + vbsPath + '"', {
          timeout: timeoutMs,
          encoding: 'utf-8',
        });
        rawOutput = outputBuffer.toString().trim();
        if (rawOutput && !rawOutput.includes('VBScript runtime error') && !rawOutput.includes('Microsoft VBScript')) {
          comSuccess = true;
        } else {
          console.error('[aeBridge] VBScript returned error/empty, switching to AfterFX.exe bridge');
        }
      } catch (comErr) {
        console.error('[aeBridge] VBScript COM execution unavailable, falling back to AfterFX.exe execution bridge');
      }

      // Attempt 2: AfterFX.exe -r dispatch fallback
      if (!comSuccess) {
        let aeExePath = '';
        try {
          const procCheck = execSync('powershell -NoProfile -Command "(Get-Process -Name AfterFX -ErrorAction SilentlyContinue).Path"', {
            encoding: 'utf-8'
          }).trim();
          if (procCheck && fs.existsSync(procCheck)) {
            aeExePath = procCheck;
          }
        } catch (_) {}

        if (!aeExePath) {
          const candidatePaths = [
            'D:\\after effects\\Adobe After Effects 2024\\Support Files\\AfterFX.exe',
            'C:\\Program Files\\Adobe\\Adobe After Effects 2025\\Support Files\\AfterFX.exe',
            'C:\\Program Files\\Adobe\\Adobe After Effects 2024\\Support Files\\AfterFX.exe',
            'C:\\Program Files\\Adobe\\Adobe After Effects 2023\\Support Files\\AfterFX.exe'
          ];
          for (const cand of candidatePaths) {
            if (fs.existsSync(cand)) {
              aeExePath = cand;
              break;
            }
          }
        }

        if (aeExePath) {
          usedAfterFXExe = true;
          console.error('[aeBridge] Dispatching ExtendScript via AfterFX.exe:', aeExePath);
          // Use & call operator for blocking execution instead of async Start-Process
          const psCommand = `powershell -NoProfile -Command "& '${aeExePath.replace(/'/g, "''")}' '-r' '${jsxPath.replace(/'/g, "''")}'"`;
          execSync(psCommand, {
            timeout: timeoutMs,
            encoding: 'utf-8'
          });
          // Give After Effects enough time to read and execute the script file
          // AfterFX.exe -r sends the script via IPC and exits; AE processes async
          execSync('powershell -NoProfile -Command "Start-Sleep -Seconds 3"');
          rawOutput = JSON.stringify({ success: true, result: "ExtendScript dispatched to After Effects via AfterFX.exe" });
        } else {
          throw new Error('After Effects executable (AfterFX.exe) not found');
        }
      }
    } catch (error) {
      console.error('[aeBridge] Error executing ExtendScript on Windows:', error);
      throw error;
    } finally {
      // When AfterFX.exe was used, defer .jsx cleanup so AE has time to finish
      // reading/executing the file asynchronously
      if (usedAfterFXExe) {
        const deferredJsxPath = jsxPath;
        setTimeout(() => {
          try {
            if (fs.existsSync(deferredJsxPath)) fs.unlinkSync(deferredJsxPath);
          } catch (e) {
            console.error('[aeBridge] Deferred cleanup failed for jsx:', e);
          }
        }, 10000); // 10-second deferred cleanup
      } else {
        try {
          if (fs.existsSync(jsxPath)) fs.unlinkSync(jsxPath);
        } catch (e) {
          console.error('[aeBridge] Cleanup failed for jsx:', e);
        }
      }
      try {
        if (fs.existsSync(vbsPath)) fs.unlinkSync(vbsPath);
      } catch (e) {
        console.error('[aeBridge] Cleanup failed for vbs:', e);
      }
    }
  } else if (platform === 'darwin') {
    try {
      const escapedScript = escapeForAppleScript(fullScript);
      const osaCommand =
        'osascript -e \'tell application id "com.adobe.aftereffects" to DoScript "' +
        escapedScript +
        '"\'';
      console.error('[aeBridge] Executing osascript');
      const outputBuffer = execSync(osaCommand, {
        timeout: timeoutMs,
        encoding: 'utf-8',
      });
      rawOutput = outputBuffer.toString().trim();
    } catch (error) {
      console.error('[aeBridge] Error executing ExtendScript on macOS:', error);
      throw error;
    }
  } else {
    throw new Error('Unsupported platform: ' + platform);
  }

  // Attempt to parse as JSON; if it fails, wrap the raw output
  try {
    JSON.parse(rawOutput);
    return rawOutput;
  } catch {
    console.error('[aeBridge] Output is not valid JSON, wrapping raw output');
    return JSON.stringify({ success: true, result: rawOutput });
  }
}
