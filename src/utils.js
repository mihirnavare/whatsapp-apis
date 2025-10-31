const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const mime = require('mime-types');

const DOWNLOADS_DIR = path.resolve(process.cwd(), 'src', 'downloads');

if (!fs.existsSync(DOWNLOADS_DIR)) fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });

function saveBase64ToFile(base64, filename) {
  const buffer = Buffer.from(base64, 'base64');
  const filePath = path.join(DOWNLOADS_DIR, filename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/**
 * Get file extension from MIME type
 * @param {string} mimeType - MIME type (e.g., 'image/jpeg')
 * @returns {string} - File extension (e.g., '.jpg')
 */
function getExtensionFromMime(mimeType) {
  const ext = mime.extension(mimeType);
  return ext ? `.${ext}` : '.bin';
}

/**
 * Create a ZIP archive from a directory
 * @param {string} sourceDir - Directory to zip
 * @param {string} outputPath - Output path for the zip file
 * @returns {Promise} - Resolves when zip is created
 */
function createZipArchive(sourceDir, outputPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('zip', {
      zlib: { level: 9 } // Compression level
    });

    output.on('close', () => {
      console.log(`[DEBUG] ZIP created: ${outputPath} (${archive.pointer()} bytes)`);
      resolve(outputPath);
    });

    archive.on('error', (err) => {
      console.error('[ERROR] Archive error:', err);
      reject(err);
    });

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

module.exports = { 
  saveBase64ToFile, 
  DOWNLOADS_DIR,
  getExtensionFromMime,
  createZipArchive
};
