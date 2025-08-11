const mongoose = require('mongoose');
const { Schema, model, Types } = mongoose;

const dailyReportSchema = new Schema({
  companyId: { // taken from JWT TOKEN
    type: Types.ObjectId,
    ref: 'Company',
    required: true
  },
  repId: { type: Types.ObjectId,ref: 'User',required: true},
  date: { // taken from the server and i have a dayjs.js in the utilts folder btw 
    type: String,
    required: true
  },
  day: {
        type: String,
        enum: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
        required: true
  },
  images: {
    type: [String], // مصفوفة روابط الصور من Cloudinary
    validate: [arrayLimit, '{PATH} exceeds the limit of 3']
  },
  notes: { // it will come from the USER
    type: String,
    default: ''
  },
  visits: [ // FROM USER
    {
      customerId: {
        type: Types.ObjectId,
        ref: 'Customer',
        required: true
      },
      status: {
        type: String,
        enum: ['visited', 'not_visited'],
        default: 'not_visited',
        required: true
      },
      reason: {
        type: String // optional، سبب عدم الزيارة لو status = not_visited
      },
       customerCode: { // Add this field
        type: String,
        default: null
      },
      notes: {
        type: String,
        default: ''
      },
      duration: {
        type: Number // بالدقائق، optional
      },
      isExtra: {
        type: Boolean,
        default: false
      }
    }
  ],
  stats: {
    totalVisits: { type: Number, default: 0 },
    totalVisited: { type: Number, default: 0 },
    totalNotVisited: { type: Number, default: 0 },
    totalExtra: { type: Number, default: 0 }
  }
}, {
  timestamps: true  // تضيف createdAt و updatedAt تلقائي
});

function arrayLimit(val) {
  return val.length <= 3; // ما بسمح بأكثر من 3 صور
}

module.exports = model('DailyReport', dailyReportSchema);
