import IORedis from 'ioredis';

let connection: IORedis | null = null;

function getRedisOpts() {
  return {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null, // required by BullMQ
  };
}

/** Shared Redis connection for BullMQ queues + workers */
export function getRedisConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(getRedisOpts());
    connection.on('error', (err) => console.error('[Redis]', err.message));
  }
  return connection;
}

/** Create a new dedicated connection (for BullMQ Worker — each worker needs its own) */
export function createRedisConnection(): IORedis {
  const conn = new IORedis(getRedisOpts());
  conn.on('error', (err) => console.error('[Redis]', err.message));
  return conn;
}

export async function closeRedisConnection(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = null;
  }
}
