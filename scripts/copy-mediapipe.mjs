// Copies the MediaPipe wasm runtime into public/ so eye tracking works with the Wi-Fi off.
// The face model (public/mediapipe/face_landmarker.task) is committed. Runs on npm install.
// OWNER: Person 3
import { cpSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
if (existsSync(src)) {
  cpSync(src, join(root, "public/mediapipe/wasm"), { recursive: true });
  console.log("copied mediapipe wasm → public/mediapipe/wasm");
}
