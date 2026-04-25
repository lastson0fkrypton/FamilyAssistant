import express from 'express';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { logger } from './logger.js';
import { pool } from './db.js';
import { runMigrations } from './db/migrations.js';
import { healthRouter } from './routes/health.js';
import { eventsRouter } from './routes/events.js';
import { schedulesRouter } from './routes/schedules.js';

const app = express();

app.use(pinoHttp({ logger }));
app.use(express.json());

// Routes
app.use('/', healthRouter);
app.use('/events', eventsRouter);
app.use('/schedules', schedulesRouter);

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
