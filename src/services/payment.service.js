// src/services/payment.service.js
const { v4: uuidv4 } = require('uuid');
const { logger } = require('../utils/logger');

//Phone helpers 

function toMsisdn(phone) {
  const clean = String(phone).replace(/[\s\-+]/g, '');
  if (clean.startsWith('265')) return clean;
  if (clean.startsWith('0'))   return '265' + clean.slice(1);
  if (clean.length === 9)      return '265' + clean;
  return clean;
}

// Maps Malawi phone prefix → pawaPay correspondent string
function getCorrespondent(phone) {
  const clean  = String(phone).replace(/[\s\-+]/g, '');
  const local  = clean.startsWith('265') ? clean.slice(3)
               : clean.startsWith('0')   ? clean.slice(1)
               : clean;
  const prefix = local.slice(0, 3);

  if (['088', '089'].includes(prefix)) return 'TNM_MPAMBA';
  if (['099', '098', '077', '078'].includes(prefix)) return 'AIRTEL_MALAWI';

  logger.warn(`getCorrespondent: unknown prefix for ${phone}, defaulting to AIRTEL_MALAWI`);
  return 'AIRTEL_MALAWI';
}

//  pawaPay Provider 
class PawaPayProvider {
  constructor() {
    this.baseUrl  = process.env.PAWAPAY_BASE_URL || 'https://api.sandbox.pawapay.io';
    this.token    = process.env.PAWAPAY_API_TOKEN;
    this.country  = process.env.PAWAPAY_COUNTRY  || 'MWI';
    this.currency = process.env.PAWAPAY_CURRENCY || 'MWK';
  }

  get _headers() {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type':  'application/json',
    };
  }

  // Deposit = collect money FROM customer (C2B)
  async collectPayment(phone, amount, ref) {
    const depositId    = uuidv4();   // pawaPay requires a UUID per transaction
    const correspondent = getCorrespondent(phone);
    const msisdn        = toMsisdn(phone);

    const body = {
      depositId,
      amount:       String(amount),
      currency:     this.currency,
      correspondent,
      payer: {
        type:    'MSISDN',
        address: { value: msisdn },
      },
      customerTimestamp:    new Date().toISOString(),
      statementDescription: `TISUNGA ${ref}`.slice(0, 22), // max 22 chars
    };

    const res = await fetch(`${this.baseUrl}/deposits`, {
      method:  'POST',
      headers: this._headers,
      body:    JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok || data.status === 'REJECTED') {
      logger.error('pawaPay deposit rejected', data);
      return {
        provider:    'PAWAPAY',
        externalRef: depositId,
        status:      'FAILED',
        message:     data?.rejectionReason?.rejectionMessage || 'Deposit rejected',
      };
    }

    logger.info(`pawaPay deposit accepted | depositId: ${depositId} | correspondent: ${correspondent}`);
    return {
      provider:    'PAWAPAY',
      externalRef: depositId,   // store this — you'll need it to match the webhook
      status:      'PENDING',   // final status comes via webhook
      message:     'USSD prompt sent to customer',
    };
  }

  // Payout = send money TO customer (B2C) — used for loan disbursements
  async disburse(phone, amount, ref) {
    const payoutId      = uuidv4();
    const correspondent = getCorrespondent(phone);
    const msisdn        = toMsisdn(phone);

    const body = {
      payoutId,
      amount:       String(amount),
      currency:     this.currency,
      country:      this.country,
      correspondent,
      recipient: {
        type:    'MSISDN',
        address: { value: msisdn },
      },
      customerTimestamp:    new Date().toISOString(),
      statementDescription: `TISUNGA ${ref}`.slice(0, 22),
    };

    const res = await fetch(`${this.baseUrl}/payouts`, {
      method:  'POST',
      headers: this._headers,
      body:    JSON.stringify(body),
    });

    const data = await res.json();

    if (!res.ok || data.status === 'REJECTED') {
      logger.error('pawaPay payout rejected', data);
      return {
        provider:    'PAWAPAY',
        externalRef: payoutId,
        status:      'FAILED',
        message:     data?.rejectionReason?.rejectionMessage || 'Payout rejected',
      };
    }

    logger.info(`pawaPay payout accepted | payoutId: ${payoutId}`);
    return {
      provider:    'PAWAPAY',
      externalRef: payoutId,
      status:      'PENDING',
      message:     'Payout initiated',
    };
  }
}

//  Mock (dev) 

class MockPaymentProvider {
  async collectPayment(phone, amount, ref) {
    const correspondent = getCorrespondent(phone);
    logger.info(`[MOCK] Collect MWK ${amount} from ${phone} via ${correspondent} | ref: ${ref}`);
    return { provider: 'MOCK', externalRef: `MOCK-${ref}`, status: 'PENDING', message: 'Mock deposit' };
  }
  async disburse(phone, amount, ref) {
    const correspondent = getCorrespondent(phone);
    logger.info(`[MOCK] Disburse MWK ${amount} to ${phone} via ${correspondent} | ref: ${ref}`);
    return { provider: 'MOCK', externalRef: `MOCK-${ref}`, status: 'PENDING', message: 'Mock payout' };
  }
}

//  Export 

const paymentService = process.env.NODE_ENV === 'production'
  ? new PawaPayProvider()
  : new MockPaymentProvider();

module.exports = { paymentService };