const fs = require('fs');
const path = require('path');

const DOWNLOADS_DIR = path.resolve(process.cwd(), 'src', 'downloads');

if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

function saveBase64ToFile(base64, filename) {
  const buffer = Buffer.from(base64, 'base64');
  const filePath = path.join(DOWNLOADS_DIR, filename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

module.exports = { saveBase64ToFile, DOWNLOADS_DIR };
