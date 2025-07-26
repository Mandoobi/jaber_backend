const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

const DEFAULT_TZ = 'Asia/Hebron';

function now() {
  return dayjs().tz(DEFAULT_TZ);
}

function parseWithTZ(dateString) {
  return dayjs(dateString).tz(DEFAULT_TZ);
}

module.exports = {
  now,
  parseWithTZ,
  dayjs, // لو حبيت تستخدمه عادي
};
