import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const rootDir = process.cwd();
const webDir = path.join(rootDir, 'apps/web');
const outputDir = path.join(webDir, 'deploy');

console.log('[Packaging] Building @remote-commander/web...');
execSync('npm --workspace=@remote-commander/web run build', { stdio: 'inherit' });

if (fs.existsSync(outputDir)) {
  fs.rmSync(outputDir, { recursive: true, force: true });
}
fs.mkdirSync(outputDir, { recursive: true });

// Copy dist/
const distSource = path.join(webDir, 'dist');
const distTarget = path.join(outputDir, 'dist');
fs.cpSync(distSource, distTarget, { recursive: true });

// Copy app.js
fs.copyFileSync(path.join(webDir, 'app.js'), path.join(outputDir, 'app.js'));

// Copy .env.example
fs.copyFileSync(path.join(webDir, '.env.example'), path.join(outputDir, '.env.example'));

// Copy README.md
fs.copyFileSync(path.join(webDir, 'README.md'), path.join(outputDir, 'README.md'));

// Generate standalone production package.json for cPanel
const pkg = JSON.parse(fs.readFileSync(path.join(webDir, 'package.json'), 'utf-8'));
const deployPkg = {
  name: pkg.name,
  version: pkg.version,
  private: true,
  main: 'app.js',
  scripts: {
    start: 'node app.js',
  },
  dependencies: {
    cors: pkg.dependencies.cors || '^2.8.5',
    dotenv: pkg.dependencies.dotenv || '^16.4.7',
    express: pkg.dependencies.express || '^4.21.2',
    'lucide-react': pkg.dependencies['lucide-react'] || '^0.475.0',
    react: pkg.dependencies.react || '^18.3.1',
    'react-dom': pkg.dependencies['react-dom'] || '^18.3.1',
  },
};
fs.writeFileSync(path.join(outputDir, 'package.json'), JSON.stringify(deployPkg, null, 2));

console.log(`[Packaging] Deployment folder created at: ${outputDir}`);

// Create zip on Windows / Linux
const zipTarget = path.join(webDir, 'remote-commander-web.zip');
try {
  if (process.platform === 'win32') {
    execSync(`powershell -Command "Compress-Archive -Path '${outputDir}\\*' -DestinationPath '${zipTarget}' -Force"`, { stdio: 'inherit' });
  } else {
    execSync(`cd "${outputDir}" && zip -r "${zipTarget}" .`, { stdio: 'inherit' });
  }
  console.log(`[Packaging] Deployable ZIP created at: ${zipTarget}`);
} catch (err) {
  console.warn('[Packaging] Note: Could not create ZIP file automatically, deploy folder is ready.');
}
