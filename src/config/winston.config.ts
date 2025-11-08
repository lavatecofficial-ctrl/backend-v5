import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import * as path from 'path';

// Configuración base para todos los loggers
const baseConfig = {
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  level: 'info'
};

// Configuración para logs de Aviator
export const aviatorLogger = winston.createLogger({
  ...baseConfig,
  transports: [
    // Log de errores
    new DailyRotateFile({
      filename: path.join('logs', 'aviator-error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true
    }),
    // Log general
    new DailyRotateFile({
      filename: path.join('logs', 'aviator-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true
    })
  ]
});

// Configuración para logs de Roulette
export const rouletteLogger = winston.createLogger({
  ...baseConfig,
  transports: [
    // Log de errores
    new DailyRotateFile({
      filename: path.join('logs', 'roulette-error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true
    }),
    // Log general
    new DailyRotateFile({
      filename: path.join('logs', 'roulette-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true
    })
  ]
});

// Configuración para logs de Spaceman
const spacemanLogger = winston.createLogger({
  ...baseConfig,
  transports: [
    // Log de errores
    new DailyRotateFile({
      filename: path.join('logs', 'spaceman-error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true
    }),
    // Log general
    new DailyRotateFile({
      filename: path.join('logs', 'spaceman-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true
    })
  ]
});

// Logger general para la aplicación
export const appLogger = winston.createLogger({
  ...baseConfig,
  transports: [
    // Log de errores
    new DailyRotateFile({
      filename: path.join('logs', 'app-error-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true
    }),
    // Log general
    new DailyRotateFile({
      filename: path.join('logs', 'app-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      zippedArchive: true
    })
  ]
});

// Los logs solo van a archivos, no a consola
// Para ver logs en tiempo real, usar: tail -f logs/aviator-*.log

// Wrappers compatibles con NestJS Logger
export class AviatorLoggerWrapper {
  log(message: any, context?: string) {
    aviatorLogger.info(message, { context });
  }

  error(message: any, trace?: string, context?: string) {
    aviatorLogger.error(message, { trace, context });
  }

  warn(message: any, context?: string) {
    aviatorLogger.warn(message, { context });
  }

  debug(message: any, context?: string) {
    aviatorLogger.debug(message, { context });
  }

  verbose(message: any, context?: string) {
    aviatorLogger.verbose(message, { context });
  }
}

export class RouletteLoggerWrapper {
  log(message: any, context?: string) {
    rouletteLogger.info(message, { context });
  }

  error(message: any, trace?: string, context?: string) {
    rouletteLogger.error(message, { trace, context });
  }

  warn(message: any, context?: string) {
    rouletteLogger.warn(message, { context });
  }

  debug(message: any, context?: string) {
    rouletteLogger.debug(message, { context });
  }

  verbose(message: any, context?: string) {
    rouletteLogger.verbose(message, { context });
  }
}

export class SpacemanLoggerWrapper {
  log(message: any, context?: string) {
    spacemanLogger.info(message, { context });
  }

  error(message: any, trace?: string, context?: string) {
    spacemanLogger.error(message, { trace, context });
  }

  warn(message: any, context?: string) {
    spacemanLogger.warn(message, { context });
  }

  debug(message: any, context?: string) {
    spacemanLogger.debug(message, { context });
  }

  verbose(message: any, context?: string) {
    spacemanLogger.verbose(message, { context });
  }
}

// Exportar también el logger por si se necesita acceso directo
export { spacemanLogger };

export class AppLoggerWrapper {
  log(message: any, context?: string) {
    appLogger.info(message, { context });
  }

  error(message: any, trace?: string, context?: string) {
    appLogger.error(message, { trace, context });
  }

  warn(message: any, context?: string) {
    appLogger.warn(message, { context });
  }

  debug(message: any, context?: string) {
    appLogger.debug(message, { context });
  }

  verbose(message: any, context?: string) {
    appLogger.verbose(message, { context });
  }
}
