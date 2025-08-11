// config/cloudinary.js
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
require('dotenv').config();

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
});

// Storage configuration
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: 'reports',
    allowed_formats: ['jpg', 'png', 'jpeg', 'webp'],
  },
});

// Multer upload middleware
const upload = multer({ storage });

// Delete image from Cloudinary
const deleteImage = async (publicId) => {
  try {
    console.log(`Deleting image with publicId: ${publicId}`);
    const result = await cloudinary.uploader.destroy(publicId);
    console.log(`Delete result for ${publicId}:`, result);
    return result;
  } catch (error) {
    console.error(`Error deleting image ${publicId}:`, error);
    throw error;
  }
};


module.exports = { cloudinary, upload, deleteImage };