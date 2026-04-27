import express from 'express';
import { pinoHttp } from 'pino-http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { logger } from './logger.js';
import { pool } from './db.js';
import { runMigrations } from './db/migrations.js';
import { healthRouter } from './routes/health.js';
import { eventsRouter } from './routes/events.js';
import { memoriesRouter } from './routes/memories.js';
import { toolsRouter } from './routes/tools.js';
import { orchestrationRouter } from './routes/orchestration.js';
import { correlationIdMiddleware } from './middleware/correlation-id.js';
import { metricsMiddleware } from './observability/metrics.js';

const app = express();
const __dirname = dirname(fileURLToPath(import.meta.url));
const uiDir = resolve(__dirname, '../../ui');

app.use(correlationIdMiddleware);
app.use(pinoHttp({
  logger,
  genReqId: (req) => req.correlationId,
  customProps: (req) => ({ correlationId: req.correlationId }),
}));
app.use(metricsMiddleware);
app.use(express.json());

// Serve local-network web UI from same API boundary.
app.use('/ui', express.static(uiDir));
app.get('/', (_req, res) => {
  res.redirect('/ui');
});

// Routes
app.use('/', healthRouter);
app.use('/events', eventsRouter);
app.use('/memories', memoriesRouter);
app.use('/tools', toolsRouter);
app.use('/', orchestrationRouter);

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Run migrations then start
runMigrations()
  .then(() => {
    const server = app.listen(config.PORT, () => {
      logger.info({ port: config.PORT, env: config.NODE_ENV }, 'API server started');
    });

    for (const signal of ['SIGTERM', 'SIGINT']) {
      process.on(signal, () => {
        logger.info({ signal }, 'Shutting down');
        server.close(async () => {
          await pool.end();
          process.exit(0);
        });
      });
    }
  })
  .catch((err) => {
    logger.error({ err }, 'Failed to run migrations — exiting');
    process.exit(1);
  });

export { app };
