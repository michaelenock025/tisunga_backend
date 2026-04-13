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
const meetingRoutes      = require('./routes/meeting.routes');
const meetingRoutes      = require('./routes/meeting.routes');
const webhookRoutes      = require('./routes/webhook.routes');

const app = express();

// Security 
app.use(helmet());
app.use(cors({
  origin: (process.env.ALLOWED_ORIGINS || '').split(','),
  credentials: true,
}));

// Parsing 
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(compression());

// Logging 
app.use(morgan('combined', {
  stream: { write: (msg) => logger.http(msg.trim()) },
}));

//  Rate limiting 
app.use(globalRateLimiter);

//API Docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Health check 
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', app: 'TISUNGA API', version: '1.0.0' });
});

// Routes 
app.use('/api/v1/auth',          authRoutes);
app.use('/api/v1/users',        userRoutes);
app.use('/api/v1/groups',       groupRoutes );
app.use('/api/v1/contributions', contributionRoutes );
app.use('/api/v1/webhooks', webhookRoutes);

app.use('/api/v1/meetings', meetingRoutes);

/*
app.use('/api/v1/loans');
app.use('/api/v1/events');
app.use('/api/v1/meetings',);
app.use('/api/v1/notifications');
app.use('/api/v1/disbursements',);
*/


//Error Handling
app.use(notFound);
app.use(errorHandler);

module.exports = app;
