import { Column, CreateDateColumn, Entity, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type {
  CollectionStatus,
  ResearchSourceKey,
  ScoreComponent,
  ScoreComponentDetail,
  SourceRunResult,
  TopicStatus,
} from '@vsf/contracts';

/** Postgres `numeric` comes back as a string; convert to number for the domain model. */
const numeric = { to: (v: number) => v, from: (v: string | null) => (v === null ? null : Number(v)) };

@Entity('niche')
export class NicheEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'workspace_id' }) workspaceId: string;
  @Column('text') name: string;
  @Column('text') slug: string;
  @Column('text', { default: '' }) description: string;
  @Column('text', { array: true }) keywords: string[];
  @Column('text', { name: 'exclude_keywords', array: true, default: () => "'{}'" }) excludeKeywords: string[];
  @Column('boolean', { default: true }) active: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity('research_source')
export class ResearchSourceEntity {
  @PrimaryColumn('text') key: ResearchSourceKey;
  @Column('text') name: string;
  @Column('boolean') enabled: boolean;
  @Column('text', { name: 'terms_url' }) termsUrl: string;
  @Column('text', { name: 'terms_notes' }) termsNotes: string;
  @Column('date', { name: 'terms_verified_at' }) termsVerifiedAt: string;
}

@Entity('trend_collection')
export class TrendCollectionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'workspace_id' }) workspaceId: string;
  @Column('uuid', { name: 'niche_id' }) nicheId: string;
  @Column('text') trigger: 'manual' | 'scheduled';
  @Column('text') status: CollectionStatus;
  @Column('text', { name: 'run_key' }) runKey: string;
  @Column('timestamptz', { name: 'window_start' }) windowStart: Date;
  @Column('timestamptz', { name: 'window_end' }) windowEnd: Date;
  @Column('timestamptz', { name: 'started_at', nullable: true }) startedAt: Date | null;
  @Column('timestamptz', { name: 'finished_at', nullable: true }) finishedAt: Date | null;
  @Column('jsonb', { name: 'source_results', default: () => "'[]'::jsonb" }) sourceResults: SourceRunResult[];
  @Column('uuid', { name: 'job_id', nullable: true }) jobId: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity('raw_signal')
export class RawSignalEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'collection_id' }) collectionId: string;
  @Column('text', { name: 'source_key' }) sourceKey: ResearchSourceKey;
  @Column('text', { name: 'external_id' }) externalId: string;
  @Column('text') url: string;
  @Column('text') title: string;
  @Column('text', { array: true, default: () => "'{}'" }) tags: string[];
  @Column('timestamptz', { name: 'published_at', nullable: true }) publishedAt: Date | null;
  @Column('timestamptz', { name: 'retrieved_at' }) retrievedAt: Date;
  @Column('jsonb', { default: () => "'{}'::jsonb" }) metrics: Record<string, number>;
  @Column('timestamptz', { name: 'expires_at', nullable: true }) expiresAt: Date | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity('trend_topic')
export class TrendTopicEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'workspace_id' }) workspaceId: string;
  @Column('uuid', { name: 'collection_id' }) collectionId: string;
  @Column('uuid', { name: 'niche_id' }) nicheId: string;
  @Column('text') title: string;
  @Column('text') slug: string;
  @Column('numeric', { precision: 6, scale: 4, transformer: numeric }) score: number;
  @Column('numeric', { precision: 4, scale: 3, transformer: numeric }) confidence: number;
  @Column('jsonb') breakdown: ScoreComponentDetail[];
  @Column('text', { name: 'missing_components', array: true, default: () => "'{}'" }) missingComponents: ScoreComponent[];
  @Column('boolean', { default: false }) stale: boolean;
  @Column('text', { array: true }) sources: ResearchSourceKey[];
  @Column('int', { name: 'signal_count' }) signalCount: number;
  @Column('timestamptz', { name: 'newest_signal_at', nullable: true }) newestSignalAt: Date | null;
  @Column('text', { default: 'new' }) status: TopicStatus;
  @Column('uuid', { name: 'decided_by', nullable: true }) decidedBy: string | null;
  @Column('timestamptz', { name: 'decided_at', nullable: true }) decidedAt: Date | null;
  @Column('text', { name: 'decision_note', nullable: true }) decisionNote: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity('trend_topic_signal')
export class TrendTopicSignalEntity {
  @PrimaryColumn('uuid', { name: 'topic_id' }) topicId: string;
  @PrimaryColumn('uuid', { name: 'signal_id' }) signalId: string;
}

@Entity('trend_metric')
export class TrendMetricEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'topic_id' }) topicId: string;
  @Column('uuid', { name: 'signal_id', nullable: true }) signalId: string | null;
  @Column('text') name: string;
  @Column('numeric', { transformer: numeric }) value: number;
  @Column('text') unit: string;
  @Column('text', { name: 'source_key' }) sourceKey: ResearchSourceKey;
  @Column('timestamptz', { name: 'observed_at' }) observedAt: Date;
  @Column('timestamptz', { name: 'retrieved_at' }) retrievedAt: Date;
  @Column('timestamptz', { name: 'expires_at', nullable: true }) expiresAt: Date | null;
}

@Entity('weekly_trend_report')
export class WeeklyTrendReportEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'collection_id' }) collectionId: string;
  @Column('text') markdown: string;
  @Column('text', { array: true, default: () => "'{}'" }) limitations: string[];
  @Column('timestamptz', { name: 'generated_at', default: () => 'now()' }) generatedAt: Date;
}

@Entity('expense_record')
export class ExpenseRecordEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'workspace_id' }) workspaceId: string;
  @Column('text') provider: string;
  @Column('text') category: 'llm' | 'tts' | 'image' | 'render' | 'storage' | 'hosting' | 'api' | 'other';
  @Column('numeric', { transformer: numeric }) units: number;
  @Column('text') unit: string;
  @Column('bigint', { name: 'amount_minor', transformer: numeric }) amountMinor: number;
  @Column('char', { length: 3, default: 'USD' }) currency: string;
  @Column('text', { name: 'related_type', nullable: true }) relatedType: string | null;
  @Column('text', { name: 'related_id', nullable: true }) relatedId: string | null;
  @Column('uuid', { name: 'job_id', nullable: true }) jobId: string | null;
  @Column('timestamptz', { name: 'occurred_at', default: () => 'now()' }) occurredAt: Date;
}

@Entity('budget')
export class BudgetEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'workspace_id' }) workspaceId: string;
  @Column('text') scope: 'global' | 'provider' | 'category';
  @Column('text', { name: 'scope_key', nullable: true }) scopeKey: string | null;
  @Column('text', { default: 'month' }) period: 'month';
  @Column('bigint', { name: 'limit_minor', transformer: numeric }) limitMinor: number;
  @Column('char', { length: 3, default: 'USD' }) currency: string;
  @Column('int', { name: 'warn_pct', default: 80 }) warnPct: number;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

export const RESEARCH_ENTITIES = [
  NicheEntity,
  ResearchSourceEntity,
  TrendCollectionEntity,
  RawSignalEntity,
  TrendTopicEntity,
  TrendTopicSignalEntity,
  TrendMetricEntity,
  WeeklyTrendReportEntity,
  ExpenseRecordEntity,
  BudgetEntity,
];
