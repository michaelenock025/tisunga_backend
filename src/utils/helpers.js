// src/utils/helpers.js
const crypto = require('crypto');


/** Generate a 6-digit numeric OTP */
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/** Generate a unique alphanumeric group code */
function generateGroupCode(length = 6) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/** Validate and normalise Malawi phone number to +265XXXXXXXXX */
function normalizeMalawiPhone(phone) {
  const cleaned = phone.replace(/\s+/g, '');
  if (/^0[897]\d{8}$/.test(cleaned))      return `+265${cleaned.slice(1)}`;
  if (/^\+265[897]\d{8}$/.test(cleaned))  return cleaned;
  if (/^265[897]\d{8}$/.test(cleaned))    return `+${cleaned}`;
  return null;
}

/** HMAC-SHA256 for webhook signature validation */
function computeHmac(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/** Pagination skip/take */
function paginate(page = 1, limit = 20) {
  const take = Math.min(limit, 100);
  const skip = (Math.max(page, 1) - 1) * take;
  return { take, skip };
}

module.exports = {
  generateOTP,
  generateGroupCode,
  normalizeMalawiPhone,
  computeHmac,
  paginate,
};
