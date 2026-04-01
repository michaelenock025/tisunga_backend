// src/config/swagger.js
const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'TISUNGA API',
      version: '1.0.0',
      description:
        'Backend API for TISUNGA — a community savings, loans and events platform for Malawi. ' +
        'All monetary values are in Malawian Kwacha (MWK). Phone numbers use +265 prefix.',
      contact: { name: 'TISUNGA Dev Team', email: 'dev@tisunga.mw' },
    },
    servers: [
      { url: 'http://localhost:3000/api/v1', description: 'Development' },
      { url: 'https://api.tisunga.mw/api/v1', description: 'Production' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Auth',          description: 'Registration, login, OTP' },
      { name: 'Users',         description: 'User profile management' },
      { name: 'Groups',        description: 'Group creation and membership' },
      { name: 'Contributions', description: 'Savings via mobile money' },
      { name: 'Loans',         description: 'Loan lifecycle' },
      { name: 'Events',        description: 'Group events' },
      { name: 'Notifications', description: 'In-app notifications' },
      { name: 'Webhooks',      description: 'Payment callbacks (internal)' },
    ],
  },
  apis: ['./src/routes/*.js', './src/controllers/*.js'],
};

const swaggerSpec = swaggerJsdoc(options);
module.exports = { swaggerSpec };
