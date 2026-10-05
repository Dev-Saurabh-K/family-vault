#!/usr/bin/env node

/**
 * FamilyVault Release Sync Pipeline
 * 
 * Automatically detects built release artifacts (ZIP & Setup.exe),
 * calculates SHA-256 checksums, transfers them to the distribution server via SSH/SCP,
 * atomically updates the web root, creates convenience symlinks, sets proper permissions,
 * and performs live HTTPS health checks.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const https = require('https');

// --- Configuration ---
const CONFIG = {
  host: process.env.RELEASE_SSH_HOST || '139.84.144.90',
  user: process.env.RELEASE_SSH_USER || 'root',
  port: process.env.RELEASE_SSH_PORT || '22',
  remoteDir: process.env.RELEASE_REMOTE_DIR || '/var/www/html',
  domain: process.env.RELEASE_DOMAIN || 'family-vault-download.duckdns.org',
  keyPath: process.env.RELEASE_SSH_KEY || path.join(os.homedir(), '.ssh', 'family_vault_deploy_key'),
};

const ROOT_DIR = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT_DIR, 'package.json');

function log(msg) {
  console.log(`[release-sync] ${msg}`);
}

function error(msg) {
  console.error(`[release-sync ERROR] ${msg}`);
}

function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', data => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function findArtifacts(version) {
  const zipDir = path.join(ROOT_DIR, 'out', 'make', 'zip', 'win32', 'x64');
  const exeDir = path.join(ROOT_DIR, 'out', 'make', 'squirrel.windows', 'x64');

  let zipPath = path.join(zipDir, `family-vault-win32-x64-${version}.zip`);
  if (!fs.existsSync(zipPath) && fs.existsSync(zipDir)) {
    const zipFiles = fs.readdirSync(zipDir).filter(f => f.endsWith('.zip'));
    if (zipFiles.length > 0) {
      zipPath = path.join(zipDir, zipFiles[0]);
    }
  }

  let exePath = path.join(exeDir, `family-vault-${version} Setup.exe`);
  if (!fs.existsSync(exePath) && fs.existsSync(exeDir)) {
    const exeFiles = fs.readdirSync(exeDir).filter(f => f.toLowerCase().endsWith('setup.exe'));
    if (exeFiles.length > 0) {
      exePath = path.join(exeDir, exeFiles[0]);
    }
  }

  return { zipPath, exePath };
}

function runSSH(cmd) {
  const sshArgs = [
    '-i', CONFIG.keyPath,
    '-p', CONFIG.port,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'BatchMode=yes',
    `${CONFIG.user}@${CONFIG.host}`,
    cmd
  ];
  return spawnSync('ssh', sshArgs, { encoding: 'utf-8' });
}

function runSCP(localPath, remotePath) {
  const scpArgs = [
    '-i', CONFIG.keyPath,
    '-P', CONFIG.port,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'BatchMode=yes',
    localPath,
    `${CONFIG.user}@${CONFIG.host}:${remotePath}`
  ];
  return spawnSync('scp', scpArgs, { encoding: 'utf-8', stdio: 'inherit' });
}

function checkHttps(url) {
  return new Promise(resolve => {
    const req = https.request(url, { method: 'HEAD', timeout: 10000 }, res => {
      resolve({
        url,
        status: res.statusCode,
        contentLength: res.headers['content-length'] || 'unknown',
        contentType: res.headers['content-type'] || 'unknown'
      });
    });
    req.on('error', err => {
      resolve({ url, status: 'ERROR', error: err.message });
    });
    req.end();
  });
}

async function main() {
  log(`Starting release synchronization to ${CONFIG.domain} (${CONFIG.host})...`);

  // 1. Verify package.json
  if (!fs.existsSync(PKG_PATH)) {
    error('package.json not found!');
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
  const version = pkg.version;
  log(`Detected project version: v${version}`);

  // 2. Verify SSH Key
  if (!fs.existsSync(CONFIG.keyPath)) {
    error(`SSH key not found at ${CONFIG.keyPath}`);
    error('Set RELEASE_SSH_KEY env var or run the key setup script first.');
    process.exit(1);
  }

  // 3. Locate release artifacts
  const { zipPath, exePath } = findArtifacts(version);

  if (!fs.existsSync(zipPath)) {
    error(`ZIP artifact not found: ${zipPath}`);
    error('Run "npm run make" first to generate release artifacts.');
    process.exit(1);
  }

  if (!fs.existsSync(exePath)) {
    error(`Setup EXE artifact not found: ${exePath}`);
    error('Run "npm run make" first to generate release artifacts.');
    process.exit(1);
  }

  const zipStats = fs.statSync(zipPath);
  const exeStats = fs.statSync(exePath);

  log(`Found ZIP artifact: ${path.basename(zipPath)} (${(zipStats.size / (1024 * 1024)).toFixed(2)} MB)`);
  log(`Found EXE artifact: ${path.basename(exePath)} (${(exeStats.size / (1024 * 1024)).toFixed(2)} MB)`);

  // 4. Calculate local hashes
  log('Computing local SHA-256 checksums...');
  const [zipHash, exeHash] = await Promise.all([
    computeFileHash(zipPath),
    computeFileHash(exePath)
  ]);
  log(`Local ZIP SHA-256: ${zipHash}`);
  log(`Local EXE SHA-256: ${exeHash}`);

  // 5. Test SSH connectivity
  log('Verifying SSH connectivity to distribution host...');
  const testConn = runSSH('echo OK');
  if (testConn.status !== 0 || !testConn.stdout.includes('OK')) {
    error(`SSH connectivity failed: ${testConn.stderr}`);
    process.exit(1);
  }
  log('SSH connection verified!');

  // 6. Upload files to staging
  const ts = Date.now();
  const remoteZipName = `family-vault-win32-x64-${version}.zip`;
  const remoteExeName = `family-vault-${version} Setup.exe`;
  const remoteExeCleanName = `family-vault-${version}-Setup.exe`;

  const stagingZip = `${CONFIG.remoteDir}/.${remoteZipName}.${ts}.tmp`;
  const stagingExe = `${CONFIG.remoteDir}/.${remoteExeCleanName}.${ts}.tmp`;

  log(`Uploading ${path.basename(zipPath)} -> ${stagingZip}...`);
  const zipUpload = runSCP(zipPath, stagingZip);
  if (zipUpload.status !== 0) {
    error('Failed to upload ZIP archive.');
    process.exit(1);
  }

  log(`Uploading ${path.basename(exePath)} -> ${stagingExe}...`);
  const exeUpload = runSCP(exePath, stagingExe);
  if (exeUpload.status !== 0) {
    error('Failed to upload EXE installer.');
    process.exit(1);
  }

  // 7. Verify remote SHA-256 hashes
  log('Verifying remote SHA-256 checksums...');
  const hashCheck = runSSH(`sha256sum '${stagingZip}' '${stagingExe}'`);
  if (hashCheck.status !== 0) {
    error(`Failed to verify remote hashes: ${hashCheck.stderr}`);
    runSSH(`rm -f '${stagingZip}' '${stagingExe}'`);
    process.exit(1);
  }

  const hashLines = hashCheck.stdout.trim().split('\n');
  const remoteHashes = {};
  for (const line of hashLines) {
    const [h, file] = line.trim().split(/\s+/);
    if (h && file) remoteHashes[file] = h.toLowerCase();
  }

  if (remoteHashes[stagingZip] !== zipHash) {
    error(`ZIP SHA-256 mismatch! Local: ${zipHash} vs Remote: ${remoteHashes[stagingZip]}`);
    runSSH(`rm -f '${stagingZip}' '${stagingExe}'`);
    process.exit(1);
  }
  if (remoteHashes[stagingExe] !== exeHash) {
    error(`EXE SHA-256 mismatch! Local: ${exeHash} vs Remote: ${remoteHashes[stagingExe]}`);
    runSSH(`rm -f '${stagingZip}' '${stagingExe}'`);
    process.exit(1);
  }
  log('Checksums matched with 100% integrity!');

  // 8. Atomic activation and symlinks
  log('Atomically updating live web files and links on the server...');
  const activationScript = `
    set -e
    # Move files to production paths
    mv '${stagingZip}' '${CONFIG.remoteDir}/${remoteZipName}'
    mv '${stagingExe}' '${CONFIG.remoteDir}/${remoteExeName}'
    
    # Create / update symlinks
    ln -sf '${CONFIG.remoteDir}/${remoteExeName}' '${CONFIG.remoteDir}/${remoteExeCleanName}'
    ln -sf '${CONFIG.remoteDir}/${remoteExeName}' '${CONFIG.remoteDir}/family-vault-setup.exe'
    ln -sf '${CONFIG.remoteDir}/${remoteZipName}' '${CONFIG.remoteDir}/family-vault-win32-x64-latest.zip'
    
    # Fix ownership and permissions for web server
    chmod 644 '${CONFIG.remoteDir}'/*
    chown -R www-data:www-data '${CONFIG.remoteDir}'
  `;

  const activationResult = runSSH(activationScript);
  if (activationResult.status !== 0) {
    error(`Activation failed: ${activationResult.stderr}`);
    process.exit(1);
  }

  log('Release activated successfully on the server!');

  // 9. Live HTTPS Health Check
  log('Validating live HTTPS download links...');
  const urlsToCheck = [
    `https://${CONFIG.domain}/${remoteZipName}`,
    `https://${CONFIG.domain}/${remoteExeCleanName}`,
    `https://${CONFIG.domain}/family-vault-setup.exe`
  ];

  const results = await Promise.all(urlsToCheck.map(checkHttps));

  console.log('\n======================================================');
  console.log('              RELEASE SYNC COMPLETE');
  console.log('======================================================');
  console.log(`Version: v${version}`);
  console.log(`Host:    ${CONFIG.host} (${CONFIG.domain})`);
  console.log('------------------------------------------------------');
  for (const r of results) {
    const ok = r.status === 200 ? '✅ OK (200)' : `❌ FAIL (${r.status})`;
    console.log(`${ok} : ${r.url}`);
    if (r.contentLength && r.contentLength !== 'unknown') {
      const mb = (Number(r.contentLength) / (1024 * 1024)).toFixed(2);
      console.log(`         Size: ${mb} MB | Type: ${r.contentType}`);
    }
  }
  console.log('======================================================\n');
}

main().catch(err => {
  error(`Unhandled exception: ${err.message}`);
  process.exit(1);
});
