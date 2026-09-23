/** Reads a File's raw bytes as a plain number array, the shape Tauri's
 * `invoke` can serialize straight into a Rust `Vec<u8>` command argument. */
export function readFileAsBytes(file: File): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(Array.from(new Uint8Array(reader.result as ArrayBuffer)));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
