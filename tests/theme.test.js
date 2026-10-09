'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Theme: index.html markup and theme configuration', () => {
  const htmlPath = path.join(__dirname, '..', 'src', 'index.html');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

  // Verify default theme is set to light on html element
  assert.ok(htmlContent.includes('<html lang="en" data-theme="light">'), 'HTML tag must have data-theme="light" default');

  // Verify theme detection script exists in head
  assert.ok(htmlContent.includes('localStorage.getItem(\'familyvault_theme\')'), 'Head must contain early theme detection script');
  assert.ok(htmlContent.includes('document.documentElement.setAttribute(\'data-theme\''), 'Early theme script must set data-theme attribute');

  // Verify launcher theme toggle button exists
  assert.ok(htmlContent.includes('id="btn-launcher-theme-toggle"'), 'Launcher must contain theme toggle button');
  assert.ok(htmlContent.includes('class="launcher-theme-icon"'), 'Launcher theme button must contain icon');

  // Verify top bar theme toggle button exists
  assert.ok(htmlContent.includes('id="btn-theme-toggle"'), 'Top bar must contain theme toggle button');
  assert.ok(htmlContent.includes('id="theme-toggle-icon"'), 'Theme toggle must contain icon element');
  assert.ok(htmlContent.includes('id="theme-toggle-text"'), 'Theme toggle must contain text element');

  // Verify Settings modal and trigger buttons exist
  assert.ok(htmlContent.includes('id="modal-settings"'), 'Must contain settings modal');
  assert.ok(htmlContent.includes('id="btn-open-settings"'), 'Top bar must contain settings button');
  assert.ok(htmlContent.includes('id="btn-launcher-settings"'), 'Launcher must contain settings button');
  assert.ok(htmlContent.includes('id="btn-theme-choice-light"'), 'Settings must contain light theme choice button');
  assert.ok(htmlContent.includes('id="btn-theme-choice-dark"'), 'Settings must contain dark theme choice button');

  // Verify search-mode-group uses clean CSS classes without hardcoded inline dark colors
  assert.ok(htmlContent.includes('class="search-mode-group"'), 'search-mode-group class must be present');
  assert.ok(!htmlContent.includes('style="display: flex; gap: 4px; background: #1e293b;'), 'search-mode-group should not have hardcoded dark background');
});

test('Theme: index.css off-white palette and light mode definitions', () => {
  const cssPath = path.join(__dirname, '..', 'src', 'index.css');
  const cssContent = fs.readFileSync(cssPath, 'utf8');

  // Verify dark mode variables
  assert.ok(cssContent.includes('[data-theme="dark"]'), 'CSS must define [data-theme="dark"] variables');
  assert.ok(cssContent.includes('--bg-primary: #212121;'), 'Dark theme must define primary dark background');

  // Verify light mode variables with off-white palette
  assert.ok(cssContent.includes('[data-theme="light"]'), 'CSS must define [data-theme="light"] variables');
  assert.ok(cssContent.includes('--bg-primary: #f7f6f2;'), 'Light theme must define off-white ivory canvas #f7f6f2');
  assert.ok(cssContent.includes('--bg-secondary: #f0eee8;'), 'Light theme must define warm stone secondary #f0eee8');
  assert.ok(cssContent.includes('--card-bg: #ffffff;'), 'Light theme must define crisp white card surface #ffffff');
  assert.ok(cssContent.includes('--text-primary: #1f2328;'), 'Light theme must define deep charcoal primary text #1f2328');
  assert.ok(cssContent.includes('--border: #ded9ce;'), 'Light theme must define warm linen border #ded9ce');

  // Verify light mode component rules exist
  assert.ok(cssContent.includes('[data-theme="light"] body'), 'Must have light mode body styling');
  assert.ok(cssContent.includes('[data-theme="light"] .launcher-card'), 'Must have light mode launcher card styling');
  assert.ok(cssContent.includes('[data-theme="light"] .top-bar'), 'Must have light mode top bar styling');
  assert.ok(cssContent.includes('[data-theme="light"] .sidebar'), 'Must have light mode sidebar styling');
  assert.ok(cssContent.includes('[data-theme="light"] .doc-card'), 'Must have light mode document card styling');
  assert.ok(cssContent.includes('[data-theme="light"] .detail-drawer'), 'Must have light mode detail drawer styling');
  assert.ok(cssContent.includes('[data-theme="light"] .modal-content'), 'Must have light mode modal styling');
  assert.ok(cssContent.includes('[data-theme="light"] .ai-response-bubble'), 'Must have light mode AI response bubble styling');
  assert.ok(cssContent.includes('[data-theme="light"] .ai-user-bubble'), 'Must have light mode user bubble styling');
  assert.ok(cssContent.includes('[data-theme="light"] #modal-users-profiles'), 'Must have light mode family profiles modal styling');
  assert.ok(cssContent.includes('[data-theme="light"] .user-contradiction-banner'), 'Must have light mode contradiction banner styling');
  assert.ok(cssContent.includes('.badge-expired'), 'Must define badge-expired class');

  // Verify select dropdown chevron and background non-repetition rules
  assert.ok(cssContent.includes('background-repeat: no-repeat !important;'), 'Selects must enforce no-repeat on dropdown chevron');
  assert.ok(cssContent.includes('[data-theme="light"] select.input-field'), 'Must define light mode select.input-field');
  assert.ok(cssContent.includes('[data-theme="light"] select.input-field:focus'), 'Must define light mode select.input-field:focus');
  assert.ok(cssContent.includes('select.input-field:focus'), 'Must define dark mode select.input-field:focus');
});

test('Theme: renderer.js theme management and event handlers', () => {
  const jsPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const jsContent = fs.readFileSync(jsPath, 'utf8');

  // Verify theme functions exist
  assert.ok(jsContent.includes('const THEME_STORAGE_KEY = \'familyvault_theme\';'), 'Must have THEME_STORAGE_KEY constant');
  assert.ok(jsContent.includes('function getStoredTheme()'), 'Must define getStoredTheme function');
  assert.ok(jsContent.includes('function applyTheme(theme)'), 'Must define applyTheme function');
  assert.ok(jsContent.includes('function setTheme(theme)'), 'Must define setTheme function');
  assert.ok(jsContent.includes('function toggleTheme()'), 'Must define toggleTheme function');
  assert.ok(jsContent.includes('function setupTheme()'), 'Must define setupTheme function');
  assert.ok(jsContent.includes('setupTheme();'), 'Must call setupTheme in initApp');

  // Verify theme toggle elements are handled
  assert.ok(jsContent.includes('btnThemeToggle.addEventListener(\'click\', toggleTheme);'), 'Must wire top bar theme toggle click');
  assert.ok(jsContent.includes('btnLauncherTheme.addEventListener(\'click\', toggleTheme);'), 'Must wire launcher theme toggle click');
  assert.ok(jsContent.includes('btnOpenSettings.addEventListener(\'click\''), 'Must wire settings button click');
  assert.ok(jsContent.includes('btnThemeChoiceLight.addEventListener(\'click\''), 'Must wire light theme choice click');
  assert.ok(jsContent.includes('btnThemeChoiceDark.addEventListener(\'click\''), 'Must wire dark theme choice click');

  // Verify search mode active-mode class toggling
  assert.ok(jsContent.includes('searchModeKeywordBtn.classList.add(\'active-mode\');'), 'Must toggle active-mode on keyword button');
  assert.ok(jsContent.includes('searchModeSemanticBtn.classList.add(\'active-mode\');'), 'Must toggle active-mode on semantic button');
});

test('UI Actions & Modals: renderer.js script integrity and topbar action bindings', () => {
  const jsPath = path.join(__dirname, '..', 'src', 'renderer.js');
  const htmlPath = path.join(__dirname, '..', 'src', 'index.html');
  const jsContent = fs.readFileSync(jsPath, 'utf8');
  const htmlContent = fs.readFileSync(htmlPath, 'utf8');

  // Verify topbar action buttons exist in index.html
  assert.ok(htmlContent.includes('id="btn-open-audit-logs"'), 'index.html must contain btn-open-audit-logs');
  assert.ok(htmlContent.includes('id="btn-create-backup"'), 'index.html must contain btn-create-backup');
  assert.ok(htmlContent.includes('id="btn-change-password-modal"'), 'index.html must contain btn-change-password-modal');

  // Verify helper functions exist and are declared in renderer.js
  assert.ok(jsContent.includes('function openChangePasswordModal()'), 'renderer.js must define openChangePasswordModal');
  assert.ok(jsContent.includes('async function handleCreateBackup()'), 'renderer.js must define handleCreateBackup');
  assert.ok(jsContent.includes('async function openAuditLogsModal()'), 'renderer.js must define openAuditLogsModal');
  assert.ok(jsContent.includes('function openQuickAddMemberModal('), 'renderer.js must define openQuickAddMemberModal');

  // Verify modal handlers are safely guarded
  assert.ok(jsContent.includes('if (btnChangePasswordModal)'), 'btnChangePasswordModal must be guarded');
  assert.ok(jsContent.includes('if (btnCreateBackup)'), 'btnCreateBackup must be guarded');
  assert.ok(jsContent.includes('if (btnOpenAuditLogs)'), 'btnOpenAuditLogs must be guarded');

  // Verify script compiles cleanly
  const vm = require('node:vm');
  assert.doesNotThrow(() => {
    new vm.Script(jsContent, { filename: 'renderer.js' });
  }, 'renderer.js must have zero compile-time or syntax errors');
});

