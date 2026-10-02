'use strict';

/**
 * Automated provisioning script to download Gemma 2 2B GGUF model and llama-server.exe
 * into the project's bin/ and models/ directories so that the app automatically
 * bundles and configures them during packaging and startup.
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { exec, spawn } = require('node:child_process');

const MODEL_URL = 'https://huggingface.co/bartowski/gemma-2-2b-it-GGUF/resolve/main/gemma-2-2b-it-Q4_K_M.gguf';
const MODEL_NAME = 'gemma-2-2b-it-Q4_K_M.gguf';
const LLAMA_WIN_BIN_URL = 'https://github.com/ggml-org/llama.cpp/releases/download/b4759/llama-b4759-bin-win-avx2-x64.zip';

const ROOT_DIR = path.resolve(__dirname, '..');
const MODELS_DIR = path.join(ROOT_DIR, 'models');
const BIN_DIR = path.join(ROOT_DIR, 'bin');

async function downloadFile(url, destPath) {
  const tempPath = destPath + '.download';
  console.log(`Starting download: ${url}`);

  return new Promise((resolve, reject) => {
    try {
      const curl = spawn('curl.exe', ['-L', '--fail', '--retry', '5', '-C', '-', '-o', tempPath, url], {
        stdio: 'inherit'
      });

      curl.on('error', () => {
        fallbackNodeDownload(url, destPath, tempPath, resolve, reject);
      });

      curl.on('exit', (code) => {
        if (code === 0 && fs.existsSync(tempPath)) {
          if (fs.existsSync(destPath)) {
            try { fs.unlinkSync(destPath); } catch (e) {}
          }
          fs.renameSync(tempPath, destPath);
          console.log('\nDownload complete.');
          return resolve(destPath);
        }
        reject(new Error(`curl exited with code ${code}`));
      });
    } catch (e) {
      fallbackNodeDownload(url, destPath, tempPath, resolve, reject);
    }
  });
}

function fallbackNodeDownload(url, destPath, tempPath, resolve, reject) {
  function get(currentUrl, redirectCount = 0) {
    if (redirectCount > 10) return reject(new Error('Too many redirects'));
    const req = https.get(currentUrl, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return get(res.headers.location, redirectCount + 1);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`Download failed with status ${res.statusCode}`));
      }
      const file = fs.createWriteStream(tempPath);
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => {
          if (fs.existsSync(destPath)) {
            try { fs.unlinkSync(destPath); } catch (e) {}
          }
          fs.renameSync(tempPath, destPath);
          console.log('\nDownload complete.');
          resolve(destPath);
        });
      });
      file.on('error', (err) => {
        try { fs.unlinkSync(tempPath); } catch (e) {}
        reject(err);
      });
    });
    req.on('error', reject);
  }
  get(url);
}

async function main() {
  console.log('=== FamilyVault Local AI Provisioning ===');

  if (!fs.existsSync(MODELS_DIR)) fs.mkdirSync(MODELS_DIR, { recursive: true });
  if (!fs.existsSync(BIN_DIR)) fs.mkdirSync(BIN_DIR, { recursive: true });

  const targetBinPath = path.join(BIN_DIR, 'llama-server.exe');
  if (fs.existsSync(targetBinPath)) {
    console.log(`✓ llama-server executable already present: ${targetBinPath}`);
  } else {
    console.log(`Downloading llama.cpp Windows binaries (~35 MB)...`);
    const tempZip = path.join(BIN_DIR, 'llama-win.zip');
    try {
      await downloadFile(LLAMA_WIN_BIN_URL, tempZip);
      console.log(`\nExtracting binaries into: ${BIN_DIR}`);
      await new Promise((resolve, reject) => {
        exec(`powershell -NoProfile -Command "Expand-Archive -Force -Path '${tempZip}' -DestinationPath '${BIN_DIR}'"`, (err) => {
          try { fs.unlinkSync(tempZip); } catch (e) {}
          if (err) return reject(new Error('Failed to extract llama binary: ' + err.message));
          resolve();
        });
      });

      if (!fs.existsSync(targetBinPath)) {
        const files = fs.readdirSync(BIN_DIR, { recursive: true });
        const serverFile = files.find(f => f.toLowerCase().endsWith('llama-server.exe'));
        if (serverFile) {
          const src = path.join(BIN_DIR, serverFile);
          fs.copyFileSync(src, targetBinPath);
        }
      }

      if (fs.existsSync(targetBinPath)) {
        console.log(`✓ llama-server executable extracted successfully: ${targetBinPath}`);
      } else {
        console.log(`Note: Please ensure llama-server.exe is present in: ${BIN_DIR}`);
      }
    } catch (err) {
      console.error(`\nFailed to download/extract llama engine: ${err.message}`);
    }
  }

  const targetModelPath = path.join(MODELS_DIR, MODEL_NAME);
  if (fs.existsSync(targetModelPath)) {
    console.log(`✓ Model already present: ${targetModelPath}`);
  } else {
    console.log(`\nDownloading Gemma 2 2B Q4_K_M GGUF (~1.6 GB)...`);
    try {
      await downloadFile(MODEL_URL, targetModelPath);
      console.log(`✓ Model saved to: ${targetModelPath}`);
    } catch (err) {
      console.error(`\nFailed to download model automatically: ${err.message}`);
      console.log(`\nYou can manually download "${MODEL_NAME}" from:`);
      console.log(`  ${MODEL_URL}`);
      console.log(`and place it in:\n  ${MODELS_DIR}\n`);
    }
  }

  console.log('Setup finished. FamilyVault will automatically bundle and launch the model on startup.');
}

if (require.main === module) {
  main();
}

module.exports = { downloadFile, main };
