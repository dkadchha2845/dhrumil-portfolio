/**
 * Generate images.json manifest for the archive gallery.
 * Merges filesystem scan with rich metadata from data/archive.json if available.
 * Run: node tools/generate-manifest.js
 */
const fs = require('fs');
const path = require('path');

const ARCHIVE_DIR = path.join(__dirname, '../images/archive');
const ARCHIVE_JSON = path.join(__dirname, '../data/archive.json');
const OUTPUT_FILE = path.join(__dirname, '../data/images.json');

// Load existing rich metadata if available
let metaLookup = {};
try {
  const raw = fs.readFileSync(ARCHIVE_JSON, 'utf8');
  const parsed = JSON.parse(raw);
  const frames = parsed.photos || parsed.frames || parsed;
  (Array.isArray(frames) ? frames : []).forEach((f) => {
    metaLookup[f.file] = f;
  });
  console.log(`Loaded metadata for ${Object.keys(metaLookup).length} images from archive.json`);
} catch (e) {
  console.log('No archive.json found, using filename-based metadata.');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${months[d.getMonth()]} ${d.getFullYear()}`;
}

function scanDir(dir) {
  let results = [];
  const files = fs.readdirSync(dir).sort();
  for (const file of files) {
    const full = path.join(dir, file);
    const stat = fs.statSync(full);
    if (stat.isDirectory() && file !== 'thumb') {
      results = results.concat(scanDir(full));
    } else {
      const ext = path.extname(file).toLowerCase();
      if (['.jpg', '.jpeg', '.png', '.webp', '.avif'].includes(ext)) {
        const src = '/' + path.relative(path.join(__dirname, '..'), full).split(path.sep).join('/');
        const thumbPath = path.join(path.dirname(full), 'thumb', file);
        const thumb = fs.existsSync(thumbPath)
          ? '/' + path.relative(path.join(__dirname, '..'), thumbPath).split(path.sep).join('/')
          : src;

        const meta = metaLookup[file] || {};
        const camera = meta.camera || '';
        const lens = meta.lens || '';
        const fStop = meta.f ? `f/${meta.f}` : '';
        const shutter = meta.shutter || '';
        const iso = meta.iso ? `ISO${meta.iso}` : '';
        const focal = meta.focal ? `${meta.focal}mm` : '';
        const title = formatDate(meta.date) || `Frame ${file.replace(/\D/g, '')}`;
        const settings = [focal, fStop, shutter, iso].filter(Boolean).join(' · ');

        results.push({
          src,
          thumb,
          filename: file,
          category: 'Archive',
          meta: { title, camera, settings },
          orient: meta.orient || 'landscape',
        });
      }
    }
  }
  return results;
}

if (!fs.existsSync(path.dirname(OUTPUT_FILE))) {
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
}

const images = scanDir(ARCHIVE_DIR);
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(images, null, 2));
console.log(`✅ Generated manifest: ${images.length} images → ${OUTPUT_FILE}`);
