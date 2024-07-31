import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const platform = process.env.PLATFORM || process.platform;
const isWindows = platform === 'win32';
const isMacOS = platform === 'darwin';
const isLinux = platform === 'linux';

const exeName = isWindows ? 'promptfoo.exe' : 'promptfoo';
const outputDir = path.join(__dirname, '..', 'dist-exe');

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Build the SEA-ready bundle
console.log('Building SEA-ready bundle...');
execSync('npm run build:exe', { stdio: 'inherit' });

// Copy the appropriate node executable
console.log('Copying node executable...');
execSync(`${isWindows ? 'copy' : 'cp'} ${process.execPath} ${path.join(outputDir, exeName)}`, {
  stdio: 'inherit',
});

// Remove signature (macOS and Windows only)
if (isMacOS) {
  console.log('Removing signature...');
  execSync(`codesign --remove-signature ${path.join(outputDir, exeName)}`, { stdio: 'inherit' });
} else if (isWindows) {
  console.log(
    'Skipping signature removal on Windows. Install Windows SDK and uncomment the line below if needed.',
  );
  // execSync(`signtool remove /s ${path.join(outputDir, exeName)}`, { stdio: 'inherit' });
}

// Inject the blob
console.log('Injecting blob...');
const postjectCommand =
  `npx postject ${path.join(outputDir, exeName)} NODE_SEA_BLOB sea-prep.blob ` +
  `--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 ` +
  `${isMacOS ? '--macho-segment-name NODE_SEA' : ''}`;

execSync(postjectCommand, { stdio: 'inherit' });

// Sign the binary (macOS and Windows only)
if (isMacOS) {
  console.log('Signing binary...');
  execSync(`codesign --sign - ${path.join(outputDir, exeName)}`, { stdio: 'inherit' });
} else if (isWindows) {
  console.log(
    'Skipping signing on Windows. Install Windows SDK and uncomment the line below if needed.',
  );
  // execSync(`signtool sign /fd SHA256 ${path.join(outputDir, exeName)}`, { stdio: 'inherit' });
}

console.log(`Single executable created: ${path.join(outputDir, exeName)}`);
