const Feedback = require('../models/Feedback');

exports.submitFeedback = async (req, res) => {
  try {
    const { rating, ratingComment, type, message, name, phone, user } = req.body;
    console.log(req.body)
    console.log(req.body.ratingComment)
    // تحقق من الحقول المطلوبة
    if (!rating || typeof rating !== 'number' || rating < 1 || rating > 5) {
      return res.status(400).json({ message: 'التقييم مطلوب ويجب أن يكون رقماً بين 1 و 5' });
    }
    if (!type || typeof type !== 'string') {
      return res.status(400).json({ message: 'نوع الملاحظة مطلوب' });
    }
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ message: 'وصف المشكلة أو الاقتراح مطلوب' });
    }
    if (phone) {
      const phoneDigits = phone.replace(/\D/g, '');
      if (phoneDigits.length < 10 || phoneDigits.length > 15) {
        return res.status(400).json({ message: 'رقم الهاتف غير صحيح، يجب أن يحتوي من 10 إلى 15 رقم' });
      }
    }

    const newFeedback = new Feedback({
      rating,
      ratingComment,
      type,
      message,
      name,
      phone,
      user
    });

    await newFeedback.save();

    return res.status(201).json({ message: 'تم استلام الملاحظات بنجاح' });

  } catch (error) {
    console.error('خطأ في submitFeedback:', error);
    return res.status(500).json({ message: 'حدث خطأ غير متوقع في الخادم' });
  }
};

exports.getAllFeedbacks = async (req, res) => {
  try {
    const feedbacks = await Feedback.find().sort({ createdAt: -1 });
    return res.json(feedbacks);
  } catch (error) {
    console.error('خطأ في getAllFeedbacks:', error);
    return res.status(500).json({ message: 'حدث خطأ غير متوقع في الخادم' });
  }
};
