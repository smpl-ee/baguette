import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';
const isTest = process.env.NODE_ENV === 'test';

const logger = pino({
  level: isTest ? 'silent' : 'info',
  transport: isDev && !isTest ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
});

export default logger;
