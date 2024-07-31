import { execSync } from 'child_process';
import * as esbuild from 'esbuild';
import * as fs from 'fs';

async function build() {
  // Bundle the application
  await esbuild.build({
    entryPoints: ['src/main.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outfile: 'dist/bundle.js',
    external: ['./node_modules/*'],
  });

  // Create sea-config.json
  const seaConfig = {
    main: 'dist/bundle.js',
    output: 'sea-prep.blob',
  };
  fs.writeFileSync('sea-config.json', JSON.stringify(seaConfig, null, 2));

  // Create the sea-prep.blob
  execSync('node --experimental-sea-config sea-config.json', { stdio: 'inherit' });
}

build().catch((err: Error) => {
  console.error(err);
  process.exit(1);
});
