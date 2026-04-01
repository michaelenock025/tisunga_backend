// src/services/sms.service.js
const { logger } = require('../utils/logger');

class AfricasTalkingProvider {
  constructor() {
    this.apiKey   = process.env.AT_API_KEY;
    this.username = process.env.AT_USERNAME || 'sandbox';
    this.senderId = process.env.AT_SENDER_ID || 'TISUNGA';
  }

  async send(to, message) {
    const params = new URLSearchParams({ username: this.username, to, message, from: this.senderId });

    const baseUrl = this.username === 'sandbox'
      ? 'https://api.sandbox.africastalking.com/version1/messaging'
      : 'https://api.africastalking.com/version1/messaging';

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { Accept: 'application/json', apiKey: this.apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`SMS send failed: ${body}`);
    }

    const data = await response.json();
    const recipients = data?.SMSMessageData?.Recipients;
    if (!recipients?.length || recipients[0].statusCode !== 101) {
      throw new Error(`SMS not delivered: ${JSON.stringify(data)}`);
    }

    logger.info(`SMS sent to ${to}`);
  }
}

class MockSmsProvider {
  async send(to, message) {
    logger.info(`[MOCK SMS] To: ${to} | Message: ${message}`);
  }
}

const smsService = process.env.NODE_ENV === 'production'
  ? new AfricasTalkingProvider()
  : new MockSmsProvider();

module.exports = { smsService };
