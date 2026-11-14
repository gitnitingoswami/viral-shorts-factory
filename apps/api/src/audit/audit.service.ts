import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { AuditEventDto, Page } from '@vsf/contracts';
import { DEFAULT_WORKSPACE_ID } from '../common/constants';
import { AuditEventEntity } from '../database/entities';

export interface AuditRecord {
  actorType: 'user' | 'system' | 'worker';
  actorId?: string | null;
  action: string;
  subjectType?: string | null;
  subjectId?: string | null;
  outcome: 'success' | 'failure';
  correlationId?: string | null;
  ip?: string | null;
  /** Must never contain secrets, tokens, passwords, or message bodies. */
  details?: Record<string, unknown>;
  workspaceId?: string;
}

const SENSITIVE_KEY = /pass|secret|token|authorization|cookie/i;

/** Drops any key that looks sensitive, as a last line of defense. */
export function redactDetails(details: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(Object.entries(details).filter(([k]) => !SENSITIVE_KEY.test(k)));
}

export function toAuditDto(e: AuditEventEntity): AuditEventDto {
  return {
    id: e.id,
    occurredAt: e.occurredAt.toISOString(),
    actorType: e.actorType,
    actorId: e.actorId,
    action: e.action,
    subjectType: e.subjectType,
    subjectId: e.subjectId,
    outcome: e.outcome,
    correlationId: e.correlationId,
  };
}

/** Append-only audit trail (UPDATE/DELETE are rejected by a DB trigger). */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectRepository(AuditEventEntity) private readonly repo: Repository<AuditEventEntity>) {}

  /** Records an event. Failures are logged loudly but never break the caller's request. */
  async record(r: AuditRecord): Promise<void> {
    try {
      await this.repo.insert({
        workspaceId: r.workspaceId ?? DEFAULT_WORKSPACE_ID,
        actorType: r.actorType,
        actorId: r.actorId ?? null,
        action: r.action,
        subjectType: r.subjectType ?? null,
        subjectId: r.subjectId ?? null,
        outcome: r.outcome,
        correlationId: r.correlationId ?? null,
        ip: r.ip ?? null,
        details: redactDetails(r.details),
      } as QueryDeepPartialEntity<AuditEventEntity>);
    } catch (err) {
      this.logger.error({ err, action: r.action }, 'FAILED TO WRITE AUDIT EVENT');
    }
  }

  async list(workspaceId: string, limit: number, offset: number): Promise<Page<AuditEventDto>> {
    const [rows, total] = await this.repo.findAndCount({
      where: { workspaceId },
      order: { occurredAt: 'DESC' },
      take: limit,
      skip: offset,
    });
    return { items: rows.map(toAuditDto), total, limit, offset };
  }
}
