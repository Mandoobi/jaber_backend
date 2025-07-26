const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
  try {
    await mongoose.connect('mongodb+srv://mandoobipro:hitVsSRmOM6fY2Dc@clustermandoobitest.whytk90.mongodb.net/myDatabaseName?retryWrites=true&w=majority&appName=ClusterMandoobitest');
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
