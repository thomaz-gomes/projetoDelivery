const sharp = require('sharp');

/**
 * Optimize an image for web display — returns WebP optimized + thumbnail.
 * @param {Buffer} buffer - Raw image buffer
 * @returns {Promise<{ optimized: Buffer, thumbnail: Buffer }>}
 */
async function optimizeForWeb(buffer) {
  const [optimized, thumbnail] = await Promise.all([
    sharp(buffer)
      .resize({ width: 800, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer(),
    sharp(buffer)
      .resize({ width: 200, withoutEnlargement: true })
      .webp({ quality: 60 })
      .toBuffer(),
  ]);

  return { optimized, thumbnail };
}

/**
 * Preserve high-quality image as JPEG 92% at original resolution.
 * Used for AI Studio images meant for social media download.
 * @param {Buffer} buffer - Raw image buffer
 * @returns {Promise<Buffer>}
 */
async function preserveHighQuality(buffer) {
  return sharp(buffer)
    .jpeg({ quality: 92 })
    .toBuffer();
}

module.exports = { optimizeForWeb, preserveHighQuality };
