const axios = require('axios');

const getLocation = async (ip) => {
  try {
    const { data } = await axios.get(`http://ip-api.com/json/${ip}`);
    if (data.status === 'success') {
      return {
        country: data.country,
        city: data.city,
        region: data.regionName
      };
    }
  } catch (err) {
    // Log if needed
  }
  return null;
};

module.exports = getLocation;
