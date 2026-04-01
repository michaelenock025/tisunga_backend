// src/utils/AppError.js
class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

function sendSuccess(res, data, message = 'Success', statusCode = 200) {
  return res.status(statusCode).json({ success: true, message, data });
}

function sendError(res, message, statusCode = 400, errors = undefined) {
  return res.status(statusCode).json({ success: false, message, ...(errors && { errors }) });
}

module.exports = { AppError, sendSuccess, sendError };
