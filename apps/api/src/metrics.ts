import type { Metrics } from '@oln/infrastructure';
import type { FastifyInstance } from 'fastify';

export function registerMetricsRoute(app: FastifyInstance, metrics: Metrics, token?: string): void {
  app.get('/metrics', async (request, reply) => {
    if (token) {
      const header = request.headers.authorization;
      if (header !== `Bearer ${token}`) {
        return reply.code(401).send({ error: 'Metrics token required.' });
      }
    }
    return reply.type('text/plain; version=0.0.4; charset=utf-8').send(metrics.render());
  });
}
