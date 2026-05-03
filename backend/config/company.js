require('dotenv').config();

module.exports = {
  name: process.env.COMPANY_NAME || 'Tsion Parboiled Brown Rice',
  phone: process.env.COMPANY_PHONE || '+251 94 413 5444',
  address: process.env.COMPANY_ADDRESS || 'Addis Ababa, Ethiopia',
  tin: process.env.COMPANY_TIN || '',
  tagline: process.env.COMPANY_TAGLINE || '100% Natural · Healthy · Gluten Free · Made in Ethiopia'
};