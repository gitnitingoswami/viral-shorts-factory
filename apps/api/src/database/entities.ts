import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { JobStatus, UserRole } from '@vsf/contracts';

/**
 * Phase 01 entities. Table/column names follow docs/DATABASE_DESIGN.md.
 * The schema is owned by migrations (src/database/migrations); `synchronize` is never used.
 */

@Entity('workspace')
export class WorkspaceEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('text') name: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity('user_account')
export class UserAccountEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'workspace_id' }) workspaceId: string;
  @Column('citext') email: string;
  @Column('text', { name: 'password_hash', select: false }) passwordHash: string;
  @Column('text') role: UserRole;
  @Column('int', { name: 'failed_login_count', default: 0 }) failedLoginCount: number;
  @Column('int', { name: 'lockout_count', default: 0 }) lockoutCount: number;
  @Column('timestamptz', { name: 'locked_until', nullable: true }) lockedUntil: Date | null;
  @Column('timestamptz', { name: 'last_login_at', nullable: true }) lastLoginAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity('refresh_session')
export class RefreshSessionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'user_id' }) userId: string;
  @Column('uuid', { name: 'family_id' }) familyId: string;
  @Column('char', { name: 'token_hash', length: 64 }) tokenHash: string;
  @Column('timestamptz', { name: 'expires_at' }) expiresAt: Date;
  @Column('timestamptz', { name: 'revoked_at', nullable: true }) revokedAt: Date | null;
  @Column('uuid', { name: 'replaced_by', nullable: true }) replacedBy: string | null;
  @Column('text', { name: 'user_agent', nullable: true }) userAgent: string | null;
  @Column('text', { nullable: true }) ip: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity('channel')
export class ChannelEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'workspace_id' }) workspaceId: string;
  @Column('text') platform: 'youtube';
  @Column('text') handle: string;
  @Column('text') title: string;
  @Column('text', { name: 'default_privacy', default: 'private' }) defaultPrivacy: 'private' | 'unlisted';
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity('connected_account')
export class ConnectedAccountEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'workspace_id' }) workspaceId: string;
  @Column('uuid', { name: 'channel_id', nullable: true }) channelId: string | null;
  @Column('text') provider: 'youtube';
  @Column('text', { name: 'external_account_id' }) externalAccountId: string;
  @Column('text', { name: 'display_name' }) displayName: string;
  @Column('text', { array: true, default: () => "'{}'" }) scopes: string[];
  @Column('text') status: 'connected' | 'expired' | 'revoked';
  @Column('uuid', { name: 'connected_by', nullable: true }) connectedBy: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity('job')
@Index(['status', 'queue'])
export class JobEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'workspace_id' }) workspaceId: string;
  @Column('text') type: string;
  @Column('text') queue: string;
  @Column('text', { name: 'idempotency_key', unique: true }) idempotencyKey: string;
  @Column('text') status: JobStatus;
  @Column('int', { default: 0 }) attempt: number;
  @Column('int', { name: 'max_attempts', default: 3 }) maxAttempts: number;
  @Column('int', { default: 0 }) progress: number;
  @Column('jsonb', { default: () => "'{}'::jsonb" }) input: Record<string, unknown>;
  @Column('jsonb', { nullable: true }) output: Record<string, unknown> | null;
  @Column('text', { nullable: true }) error: string | null;
  @Column('text', { name: 'correlation_id', nullable: true }) correlationId: string | null;
  @Column('uuid', { name: 'created_by', nullable: true }) createdBy: string | null;
  @Column('timestamptz', { name: 'started_at', nullable: true }) startedAt: Date | null;
  @Column('timestamptz', { name: 'finished_at', nullable: true }) finishedAt: Date | null;
  @Column('text', { name: 'lease_owner', nullable: true }) leaseOwner: string | null;
  @Column('timestamptz', { name: 'lease_until', nullable: true }) leaseUntil: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity('audit_event')
export class AuditEventEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'workspace_id' }) workspaceId: string;
  @CreateDateColumn({ name: 'occurred_at', type: 'timestamptz' }) occurredAt: Date;
  @Column('text', { name: 'actor_type' }) actorType: 'user' | 'system' | 'worker';
  @Column('uuid', { name: 'actor_id', nullable: true }) actorId: string | null;
  @Column('text') action: string;
  @Column('text', { name: 'subject_type', nullable: true }) subjectType: string | null;
  @Column('text', { name: 'subject_id', nullable: true }) subjectId: string | null;
  @Column('text') outcome: 'success' | 'failure';
  @Column('text', { name: 'correlation_id', nullable: true }) correlationId: string | null;
  @Column('text', { nullable: true }) ip: string | null;
  @Column('jsonb', { default: () => "'{}'::jsonb" }) details: Record<string, unknown>;
}

import { CONTENT_ENTITIES } from './content.entities';
import { RESEARCH_ENTITIES } from './research.entities';
import { VIDEO_ENTITIES } from './video.entities';

export const ALL_ENTITIES = [
  ...RESEARCH_ENTITIES,
  ...CONTENT_ENTITIES,
  ...VIDEO_ENTITIES,
  WorkspaceEntity,
  UserAccountEntity,
  RefreshSessionEntity,
  ChannelEntity,
  ConnectedAccountEntity,
  JobEntity,
  AuditEventEntity,
];
