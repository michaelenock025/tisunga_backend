// src/app.js
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const swaggerUi = require('swagger-ui-express');

const { globalRateLimiter } = require('./middleware/rateLimiter');
const { errorHandler } = require('./middleware/errorHandler');
const { notFound } = require('./middleware/notFound');
const { swaggerSpec } = require('./config/swagger');
const { logger } = require('./utils/logger');

const authRoutes         = require('./routes/auth.routes');
const userRoutes         = require('./routes/user.routes');
const groupRoutes        = require('./routes/group.routes');
const contributionRoutes = require('./routes/contribution.routes');
const loanRoutes         = require('./routes/loan.routes');
const eventRoutes        = require('./routes/event.routes');
const meetingRoutes      = require('./routes/meeting.routes');
const disbursementRoutes = require('./routes/disbursement.routes');
const notificationRoutes = require('./routes/notification.routes');
const webhookRoutes      = require('./routes/webhook.routes');

const app = express();

app.use(helmet());
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || '').split(','),
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(compression());
app.use(morgan('combined', { stream: { write: (msg) => logger.http(msg.trim()) } }));
app.use(globalRateLimiter);

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', app: 'TISUNGA API', version: '2.0.0' });
});

app.use('/api/v1/auth',          authRoutes);
app.use('/api/v1/users',         userRoutes);
app.use('/api/v1/groups',        groupRoutes);
app.use('/api/v1/contributions', contributionRoutes);
app.use('/api/v1/loans',         loanRoutes);
app.use('/api/v1/events',        eventRoutes);
app.use('/api/v1/meetings',      meetingRoutes);
app.use('/api/v1/disbursements', disbursementRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/webhooks',      webhookRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;