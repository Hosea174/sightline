import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tauriDir = path.join(root, 'src-tauri');
const extSrc = path.join(root, 'extension');
const extDest = path.join(tauriDir, 'resources', 'extension');
const binariesDir = path.join(tauriDir, 'binaries');
const triple = process.platform === 'win32' ? 'x86_64-pc-windows-msvc' : `${process.arch}-${process.platform}`;
const exeExt = process.platform === 'win32' ? '.exe' : '';
const stagedBridge = path.join(binariesDir, `sightline-bridge-${triple}${exeExt}`);

const requiredUiFiles = [path.join(extSrc, 'ui', 'ui.js'), path.join(extSrc, 'ui', 'ui.css')];
for (const file of requiredUiFiles) {
  if (!fs.existsSync(file)) {
    console.error(`Missing built extension asset: ${file}. Run "bun run build" first.`);
    process.exit(1);
  }
}

fs.rmSync(extDest, { recursive: true, force: true });
fs.mkdirSync(extDest, { recursive: true });

for (const entry of fs.readdirSync(extSrc, { withFileTypes: true })) {
  const srcPath = path.join(extSrc, entry.name);
  const dstPath = path.join(extDest, entry.name);
  if (entry.isDirectory()) {
    if (entry.name === 'icons' || entry.name === 'ui') {
      fs.cpSync(srcPath, dstPath, { recursive: true });
    }
  } else if (entry.isFile()) {
    if (entry.name === 'ui.tsx' || entry.name === 'ui.css') continue;
    if (entry.name === 'manifest.json' || entry.name === 'interaction.css' || /\.(html|js)$/.test(entry.name)) {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

// Create binaries directory and ensure a file exists so tauri_build::build() succeeds during bridge compilation.
fs.mkdirSync(binariesDir, { recursive: true });
if (!fs.existsSync(stagedBridge)) {
  fs.writeFileSync(stagedBridge, '');
}

const buildResult = spawnSync(
  'cargo',
  ['build', '--release', '--manifest-path', path.join(tauriDir, 'Cargo.toml'), '--bin', 'sightline-bridge'],
  { cwd: root, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  process.exit(buildResult.status ?? 1);
}

const builtBridge = path.join(tauriDir, 'target', 'release', `sightline-bridge${exeExt}`);
if (!fs.existsSync(builtBridge)) {
  console.error(`Expected built bridge binary at ${builtBridge}`);
  process.exit(1);
}
fs.copyFileSync(builtBridge, stagedBridge);
console.log(`Prepared sidecar (${stagedBridge}) and extension resources (${extDest}).`);
