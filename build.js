#!/usr/bin/env node
/*
 * build.js — package a course into a SCORM 1.2 zip-ready folder.
 *
 *   node build.js --course demo-course
 *
 * Validates the config with the same validator the player runs, then stages:
 *   dist/<courseId>/index.html
 *   dist/<courseId>/config.json
 *   dist/<courseId>/src/{validation,scorm,engine}.js + styles.css
 *   dist/<courseId>/imsmanifest.xml   (SCORM 1.2)
 *
 * Then zip the dist/<courseId> folder (right-click > Compress) and upload
 * the zip to SCORM Cloud. No npm dependencies — plain Node only.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { validateConfig } = require('./src/validation.js');

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const courseName = argValue('--course') || 'demo-course';
const root = __dirname;
const courseDir = path.join(root, 'courses', courseName);
const configPath = path.join(courseDir, 'config.json');

if (!fs.existsSync(configPath)) {
  console.error('Course not found: ' + courseDir);
  console.error('Usage: node build.js --course <folder-name-in-courses/>');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const result = validateConfig(config);

result.warnings.forEach(w => console.warn('WARN  [' + w.path + '] ' + w.message));
if (!result.valid) {
  result.errors.forEach(e => console.error('ERROR [' + e.path + '] ' + e.message));
  console.error('\nBuild stopped: fix the config errors above.');
  process.exit(1);
}

const outDir = path.join(root, 'dist', config.meta.courseId);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

fs.copyFileSync(path.join(root, 'index.html'), path.join(outDir, 'index.html'));
fs.copyFileSync(configPath, path.join(outDir, 'config.json'));
fs.cpSync(path.join(root, 'src'), path.join(outDir, 'src'), { recursive: true });

const files = [
  'index.html',
  'config.json',
  'src/validation.js',
  'src/scorm.js',
  'src/engine.js',
  'src/styles.css'
];
const fileTags = files.map(f => '      <file href="' + f + '"/>').join('\n');

const manifest =
  '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<manifest identifier="MANIFEST-' + escXml(config.meta.courseId) + '" version="1.2"\n' +
  '  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"\n' +
  '  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"\n' +
  '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"\n' +
  '  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd\n' +
  '    http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd\n' +
  '    http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">\n' +
  '  <organizations default="ORG-1">\n' +
  '    <organization identifier="ORG-1">\n' +
  '      <title>' + escXml(config.meta.title) + '</title>\n' +
  '      <item identifier="ITEM-1" identifierref="RES-1">\n' +
  '        <title>' + escXml(config.meta.title) + '</title>\n' +
  '      </item>\n' +
  '    </organization>\n' +
  '  </organizations>\n' +
  '  <resources>\n' +
  '    <resource identifier="RES-1" type="webcontent" adlcp:scormtype="sco" href="index.html">\n' +
  fileTags + '\n' +
  '    </resource>\n' +
  '  </resources>\n' +
  '</manifest>\n';

fs.writeFileSync(path.join(outDir, 'imsmanifest.xml'), manifest);

console.log('Config valid. Built: dist/' + config.meta.courseId + '/');
console.log('Next steps:');
console.log('  1. Zip the folder dist/' + config.meta.courseId + ' (right-click > Compress/Zip).');
console.log('  2. Upload the zip to SCORM Cloud and launch it.');
console.log('  3. Verify: completion status, score, and close-the-browser resume.');
