// src/__tests__/helpers.test.js
const {
  generateGroupCode,
  generateOTP,
  generateTransactionRef,
  normalizeMalawiPhone,
  calculateLoanRepayable,
  calculateDueDate,
  repaymentPercent,
  paginate,
} = require('../utils/helpers');

describe('generateGroupCode', () => {
  it('generates a 9-character alphanumeric code', () => {
    const code = generateGroupCode();
    expect(code).toHaveLength(9);
    expect(/^[A-Z0-9]{9}$/.test(code)).toBe(true);
  });

  it('generates unique codes across 1000 calls', () => {
    const codes = new Set(Array.from({ length: 1000 }, generateGroupCode));
    expect(codes.size).toBeGreaterThan(990);
  });
});

describe('generateOTP', () => {
  it('returns a 6-digit numeric string', () => {
    const otp = generateOTP();
    expect(otp).toHaveLength(6);
    expect(/^\d{6}$/.test(otp)).toBe(true);
  });
});

describe('generateTransactionRef', () => {
  it('generates a TISU-prefixed reference', () => {
    const ref = generateTransactionRef();
    expect(ref).toMatch(/^TISU\d{5}\.\d{2}$/);
  });
});

describe('normalizeMalawiPhone', () => {
  const cases = [
    ['0882752624',    '+265882752624'],
    ['+265882752624', '+265882752624'],
    ['265882752624',  '+265882752624'],
    ['0997486222',    '+265997486222'],
    ['0712345678',    null],
    ['088275262',     null],
    ['invalid',       null],
  ];

  test.each(cases)('normalizes %s → %s', (input, expected) => {
    expect(normalizeMalawiPhone(input)).toBe(expected);
  });
});

describe('calculateLoanRepayable', () => {
  it('applies flat 5% interest correctly', () => {
    expect(calculateLoanRepayable(650000, 5)).toBeCloseTo(682500);
  });

  it('handles zero interest', () => {
    expect(calculateLoanRepayable(100000, 0)).toBe(100000);
  });

  it('handles 10% interest', () => {
    expect(calculateLoanRepayable(200000, 10)).toBeCloseTo(220000);
  });
});

describe('calculateDueDate', () => {
  it('adds months to a given date', () => {
    const start = new Date('2026-02-01');
    const due   = calculateDueDate(start, 9);
    expect(due.getFullYear()).toBe(2026);
    expect(due.getMonth()).toBe(10); // November (0-indexed)
    expect(due.getDate()).toBe(1);
  });

  it('handles year boundary correctly', () => {
    const start = new Date('2026-10-15');
    const due   = calculateDueDate(start, 6);
    expect(due.getFullYear()).toBe(2027);
    expect(due.getMonth()).toBe(3); // April
  });
});

describe('repaymentPercent', () => {
  it('calculates 50% repaid correctly', () => {
    expect(repaymentPercent(700000, 350000)).toBe(50);
  });

  it('calculates fully repaid as 100%', () => {
    expect(repaymentPercent(700000, 0)).toBe(100);
  });

  it('calculates 0% when nothing repaid', () => {
    expect(repaymentPercent(700000, 700000)).toBe(0);
  });
});

describe('paginate', () => {
  it('returns correct skip/take for page 1', () => {
    expect(paginate(1, 20)).toEqual({ take: 20, skip: 0 });
  });

  it('returns correct skip for page 3', () => {
    expect(paginate(3, 20)).toEqual({ take: 20, skip: 40 });
  });

  it('caps take at 100', () => {
    expect(paginate(1, 500)).toEqual({ take: 100, skip: 0 });
  });

  it('handles page 0 as page 1', () => {
    expect(paginate(0, 10)).toEqual({ take: 10, skip: 0 });
  });
});
