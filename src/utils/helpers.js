// src/utils/helpers.js
const crypto = require('crypto');
 
/** Generate TISU-prefixed transaction ref e.g. TISU29993.90 */
function generateTransactionRef() {
  const numeric = Math.floor(Math.random() * 99999) + 10000;
  const decimal = Math.floor(Math.random() * 100);
  return `TISU${numeric}.${String(decimal).padStart(2, '0')}`;
}
 
/** Generate 9-character group join code e.g. 467WEISH6 */
function generateGroupCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 9 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}
 
/** Generate a 6-digit numeric OTP */
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
 
/** Validate and normalise Malawi phone number to +265XXXXXXXXX */
function normalizeMalawiPhone(phone) {
  const cleaned = String(phone).replace(/\s+/g, '');
  if (/^0[897]\d{8}$/.test(cleaned))      return `+265${cleaned.slice(1)}`;
  if (/^\+265[897]\d{8}$/.test(cleaned))  return cleaned;
  if (/^265[897]\d{8}$/.test(cleaned))    return `+${cleaned}`;
  return null;
}
 
/** Flat-rate loan interest: principal × (1 + rate/100) */
function calculateLoanRepayable(principal, ratePercent) {
  return principal * (1 + ratePercent / 100);
}
 
/** Add months to a date */
function calculateDueDate(fromDate, months) {
  const d = new Date(fromDate);
  d.setMonth(d.getMonth() + months);
  return d;
}
 
/** Repayment progress as integer percentage */
function repaymentPercent(totalRepayable, remaining) {
  const paid = totalRepayable - remaining;
  return Math.round((paid / totalRepayable) * 100);
}
 
/** HMAC-SHA256 for webhook signature validation */
function computeHmac(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}
 
/** Format MWK currency string */
function formatMWK(amount) {
  return `MK ${Number(amount).toLocaleString('en-MW', { minimumFractionDigits: 2 })}`;
}
 
/** Pagination skip/take */
function paginate(page = 1, limit = 20) {
  const take = Math.min(limit, 100);
  const skip = (Math.max(page, 1) - 1) * take;
  return { take, skip };
}
 
/**
 * Calculate each member's share of the total savings pool.
 *
 * Each member gets back exactly what they saved (memberSavings).
 * Any rounding remainder goes to the first member (usually the Chair).
 * Returns array sorted descending by memberSavings.
 *
 * @param {Array}  memberships  - GroupMembership rows (must include user)
 * @param {number} totalSavings - Group's totalSavings as a number
 * @returns {Array<{ userId, memberSavings, shareAmount }>}
 */
function calculateMemberShares(memberships, totalSavings) {
  if (!memberships.length) return [];
 
  const totalMemberSavings = memberships.reduce(
    (sum, m) => sum + parseFloat(m.memberSavings.toString()),
    0
  );
 
  let distributed = 0;
  const shares = memberships.map((m, idx) => {
    const memberSavings = parseFloat(m.memberSavings.toString());
 
    // Proportional share of total pool (handles interest/fees accumulated at group level)
    const proportion  = totalMemberSavings > 0 ? memberSavings / totalMemberSavings : 1 / memberships.length;
    let shareAmount   = Math.floor(proportion * totalSavings * 100) / 100; // round down to 2dp
 
    distributed += shareAmount;
    return { userId: m.userId, memberSavings, shareAmount, _idx: idx };
  });
 
  // Give any rounding remainder (a few tambala) to the first member
  const remainder = Math.round((totalSavings - distributed) * 100) / 100;
  if (remainder > 0 && shares.length > 0) {
    shares[0].shareAmount = Math.round((shares[0].shareAmount + remainder) * 100) / 100;
  }
 
  return shares.map(({ userId, memberSavings, shareAmount }) => ({
    userId,
    memberSavings,
    shareAmount,
  }));
}
 
module.exports = {
  generateTransactionRef,
  generateGroupCode,
  generateOTP,
  normalizeMalawiPhone,
  calculateLoanRepayable,
  calculateDueDate,
  repaymentPercent,
  computeHmac,
  formatMWK,
  paginate,
  calculateMemberShares,
};