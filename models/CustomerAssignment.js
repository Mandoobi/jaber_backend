const mongoose = require('mongoose');

const customerAssignmentSchema = new mongoose.Schema(
  {
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true
    },
    repId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true // Add index for faster lookups
    }
  },
  { timestamps: true }
);

// Compound indexes
customerAssignmentSchema.index({ customerId: 1, repId: 1 }, { unique: true });
customerAssignmentSchema.index({ repId: 1, companyId: 1 }); // For rep assignments lookup
customerAssignmentSchema.index({ companyId: 1, createdAt: -1 }); // For recent assignments

module.exports = mongoose.model('CustomerAssignment', customerAssignmentSchema);
