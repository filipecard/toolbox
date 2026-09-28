/** Reads a File's raw bytes — sent as-is as a command's raw IPC body (see
 * `invokeWithFile` in tauri.ts). */
export async function readFileAsBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
