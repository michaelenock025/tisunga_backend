const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('./cloudinary');

/**
 * Build a Cloudinary-backed multer storage engine.
 *
 * @param {string} folder  - Cloudinary folder, e.g. 'tisunga/avatars'
 * @param {object} [transformation] - Optional Cloudinary eager transformations
 */

function makeStorage(folder, transformation) {
  return new CloudinaryStorage({
    cloudinary,
    params: async (_req, file) => {
      if (!file.mimetype.startsWith('image/')) {
        throw new Error('Only images are allowed');
      }
      return {
        folder,
        resource_type: 'image',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
        quality: 'auto',
        fetch_format: 'auto',
        ...(transformation ? { transformation } : {}),
      };
    },
  });
}

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only images are allowed'), false);
  }
};

const uploadAvatar = multer({
  storage: makeStorage('tisunga/avatars', [
    { width: 400, height: 400, crop: 'fill' },
  ]),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});
const uploadMeetingImage = multer({
  
  storage: makeStorage('tisunga/meetings'),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

module.exports = {uploadAvatar, uploadMeetingImage };