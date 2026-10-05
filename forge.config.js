const fs = require('node:fs');
const path = require('node:path');
const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

const extraResources = [];
if (fs.existsSync(path.join(__dirname, 'bin'))) extraResources.push('./bin');
// Keep the installer small by default (~90 MB with PaddleOCR). The user can download Gemma-4-E2B on-demand in the app.
if (process.env.BUNDLE_MODEL === 'true' && fs.existsSync(path.join(__dirname, 'models'))) {
  extraResources.push('./models');
} else if (fs.existsSync(path.join(__dirname, 'models', 'paddleocr'))) {
  extraResources.push('./models/paddleocr');
}

module.exports = {
  packagerConfig: {
    asar: true,
    extraResource: extraResources,
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['win32'],
    },
    {
      name: '@electron-forge/maker-deb',
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {},
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
