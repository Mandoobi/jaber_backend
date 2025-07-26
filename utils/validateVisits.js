const mongoose = require('mongoose');

function validateVisits(visits) {
  if (!Array.isArray(visits) || visits.length === 0)
    return '📛 الزيارات يجب أن تكون مصفوفة غير فارغة';

  for (const visit of visits) {
    if (!visit.customerId || !mongoose.Types.ObjectId.isValid(visit.customerId)) {
      return '📛 كل زيارة يجب أن تحتوي على customerId صالح';
    }
    if (!['visited', 'not_visited'].includes(visit.status)) {
      return '📛 الحالة غير صالحة (visited أو not_visited)';
    }
    if (visit.status === 'not_visited' && (!visit.reason || visit.reason.trim() === '')) {
      return '📛 السبب مطلوب إذا كانت الزيارة لم تتم';
    }
    if (
      visit.duration !== undefined &&
      (typeof visit.duration !== 'number' || visit.duration < 0)
    ) {
      return '📛 المدة يجب أن تكون رقمًا موجبًا';
    }
  }
  return null;
}

module.exports = validateVisits;
