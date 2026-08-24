/**
 * Escapes a string for safe embedding inside AppleScript string literals.
 * @param str The string to escape.
 * @returns The escaped string.
 */
export declare function escapeForAppleScript(str: string): string;
/**
 * Escapes a string for safe embedding inside VBScript string literals.
 * Doubles all double-quote characters.
 * @param str The string to escape.
 * @returns The escaped string.
 */
export declare function escapeForVBS(str: string): string;
/**
 * Builds the complete ExtendScript payload by combining the JSON polyfill,
 * undo group wrapper, try/catch error envelope, and the user's script.
 * @param userScript The raw ExtendScript code to execute.
 * @returns The full wrapped ExtendScript payload string.
 */
export declare function buildScript(userScript: string): string;
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
export declare function runExtendScript(script: string, timeoutMs?: number): Promise<string>;
//# sourceMappingURL=aeBridge.d.ts.map