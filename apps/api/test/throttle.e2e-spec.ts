import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import './enable-throttle'; // must stay above the helpers import: config is read at module load
import { createTestApp, resetTestDatabase } from './helpers';

describe('rate limiting (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    await resetTestDatabase();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('limits login attempts to 5 per minute per client', async () => {
    const http = app.getHttpServer() as App;
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(http).post('/api/auth/login').send({ email: 'a@test.local', password: 'wrong-pass' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });
});
