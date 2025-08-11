const DailyReport = require('../models/DailyReport');
const Customer = require('../models/Customer');
const Sample = require('../models/Sample');
const Product = require('../models/Product');
const ExcelJS = require('exceljs');

exports.exportDailyReportById = async (req, res) => {
  try {
    const { id } = req.params;

    const report = await DailyReport.findById(id)
      .populate('repId', 'fullName')
      .populate('visits.customerId', 'fullName city');

    if (!report) {
      return res.status(404).json({ message: 'لم يتم العثور على التقرير' });
    }

    const samples = await Sample.find({ reportId: id }).populate('productId', 'name weight weightUnit unitType');

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('تقرير يومي');

    const headerStyle = {
      font: { bold: true, size: 13 },
      alignment: { vertical: 'middle', horizontal: 'center' },
      fill: {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFDCE6F1' }
      }
    };

    const titleStyle = {
      font: { bold: true, size: 16 },
      alignment: { vertical: 'middle', horizontal: 'center' }
    };

    // ====== عنوان التقرير ======
    sheet.mergeCells('A1', 'H1');
    sheet.getCell('A1').value = '📋 ملخص التقرير اليومي';
    sheet.getCell('A1').style = titleStyle;
    sheet.addRow([]);

    const generalInfo = [
      ['🆔 رقم التقرير', report._id.toString()],
      ['📅 التاريخ', report.date || 'تاريخ غير صالح'],
      ['📆 اليوم', report.day],
      ['👤 اسم المندوب', report.repId?.fullName || 'غير معروف'],
      ['📝 ملاحظات عامة', report.notes || '-']
    ];
    generalInfo.forEach(row => sheet.addRow(row));
    sheet.addRow([]);

    const stats = [
      ['إجمالي الزيارات', report.stats.totalVisits],
      ['الزيارات المنجزة', report.stats.totalVisited],
      ['الزيارات غير المنجزة', report.stats.totalNotVisited],
      ['الزيارات الإضافية', report.stats.totalExtra]
    ];
    stats.forEach(row => sheet.addRow(row));
    sheet.addRow([]);

    // ====== جدول الزيارات ======
    sheet.addRow(['اسم العميل', 'كود العميل', 'المدينة', 'الحالة', 'سبب عدم الزيارة', 'ملاحظات الزيارة', 'المدة (دقيقة)', 'زيارة إضافية'])
      .eachCell(cell => Object.assign(cell.style, headerStyle));

    report.visits.forEach(visit => {
      sheet.addRow([
        visit.customerId?.fullName || '-',
        visit.customerCode || '-',
        visit.customerId?.city || '-',
        visit.status === 'visited' ? 'تمت' : 'لم تتم',
        visit.reason || '-',
        visit.notes || '-',
        visit.duration || 0,
        visit.isExtra ? 'نعم' : 'لا'
      ]);
    });
    sheet.addRow([]);

    // ====== جدول العينات ======
    if (samples.length) {
      sheet.addRow(['نوع المستلم', 'اسم المنتج', 'الكمية', 'الوزن', 'وحدة الوزن', 'نوع الوحدة', 'كود العميل', 'اسم العميل', 'ملاحظات'])
        .eachCell(cell => Object.assign(cell.style, headerStyle));

      samples.forEach(sample => {
        const customer = report.visits.find(v => v._id.equals(sample.visitId))?.customerId;
        sheet.addRow([
          sample.type === 'customer' ? 'عميل' : 'استخدام شخصي',
          sample.productId?.name || '-',
          sample.quantity,
          sample.productId?.weight || '-',
          sample.productId?.weightUnit || '-',
          sample.productId?.unitType || '-',
          customer?.customerCode || '-',
          customer?.fullName || '-',
          sample.notes || '-'
        ]);
      });
    }

    // Auto-size columns
    sheet.columns.forEach(col => {
      let maxLength = 12;
      col.eachCell({ includeEmpty: true }, cell => {
        const len = (cell.value || '').toString().length;
        if (len > maxLength) maxLength = len;
      });
      col.width = maxLength + 2;
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const fileName = 'report-2025-08-03.xlsx'; // فقط أحرف وأرقام
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ message: 'فشل في تصدير التقرير' });
  }
};
