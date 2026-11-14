import { Repository } from 'typeorm';
import { AuditEventEntity } from '../database/entities';
import { AuditService, redactDetails } from './audit.service';

describe('redactDetails', () => {
  it('drops sensitive keys and keeps the rest', () => {
    expect(
      redactDetails({ statusCode: 200, password: 'x', accessToken: 'y', refresh_token: 'z', Cookie: 'c', clientSecret: 's', reason: 'ok' }),
    ).toEqual({ statusCode: 200, reason: 'ok' });
  });
});

describe('AuditService.record', () => {
  it('never throws when the insert fails', async () => {
    const repo = { insert: jest.fn().mockRejectedValue(new Error('db down')) } as unknown as Repository<AuditEventEntity>;
    await expect(new AuditService(repo).record({ actorType: 'system', action: 'x', outcome: 'success' })).resolves.toBeUndefined();
  });

  it('defaults the workspace and nulls optional fields', async () => {
    const insert = jest.fn().mockResolvedValue({});
    await new AuditService({ insert } as unknown as Repository<AuditEventEntity>).record({
      actorType: 'user',
      action: 'auth.login',
      outcome: 'failure',
      details: { password: 'never-stored', reason: 'bad_password' },
    });
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: '00000000-0000-4000-8000-000000000001',
        actorId: null,
        details: { reason: 'bad_password' },
      }),
    );
  });
});
