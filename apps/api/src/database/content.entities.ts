import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import type {
  CheckState,
  ClaimVerdict,
  CodeCheckStatus,
  CodeLanguage,
  IdeaFormat,
  IdeaStatus,
  QualityDimension,
  ScriptStatus,
  SourceRef,
  StoryboardSceneDto,
} from '@vsf/contracts';

const numeric = { to: (v: number) => v, from: (v: string | null) => (v === null ? null : Number(v)) };

@Entity('content_idea')
export class ContentIdeaEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'workspace_id' }) workspaceId: string;
  @Column('uuid', { name: 'topic_id' }) topicId: string;
  @Column('text') title: string;
  @Column('text') audience: string;
  @Column('text') angle: string;
  @Column('text') hook: string;
  @Column('text', { name: 'value_proposition' }) valueProposition: string;
  @Column('text') format: IdeaFormat;
  @Column('int', { name: 'target_duration_sec' }) targetDurationSec: number;
  @Column('jsonb', { name: 'source_refs', default: () => "'[]'::jsonb" }) sourceRefs: SourceRef[];
  @Column('numeric', { name: 'similarity_score', precision: 4, scale: 3, default: 0, transformer: numeric }) similarityScore: number;
  @Column('uuid', { name: 'duplicate_of_id', nullable: true }) duplicateOfId: string | null;
  @Column('text', { default: 'proposed' }) status: IdeaStatus;
  @Column('text', { name: 'llm_model' }) llmModel: string;
  @Column('text', { name: 'prompt_ref' }) promptRef: string;
  @Column('boolean', { name: 'llm_mock' }) llmMock: boolean;
  @Column('uuid', { name: 'job_id', nullable: true }) jobId: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

@Entity('video_script')
export class VideoScriptEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'workspace_id' }) workspaceId: string;
  @Column('uuid', { name: 'idea_id' }) ideaId: string;
  @Column('text') title: string;
  @Column('text', { default: 'drafting' }) status: ScriptStatus;
  @Column('int', { name: 'current_version', default: 0 }) currentVersion: number;
  @Column('int', { name: 'approved_version', nullable: true }) approvedVersion: number | null;
  @Column('uuid', { name: 'job_id', nullable: true }) jobId: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' }) updatedAt: Date;
}

/** Persisted script body (scenes); the canonical JSON of {title, scenes} is hashed into `contentHash`. */
export interface ScriptBody {
  scenes: StoryboardSceneDto[];
}

@Entity('script_version')
export class ScriptVersionEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'script_id' }) scriptId: string;
  @Column('int') version: number;
  @Column('text', { name: 'author_type' }) authorType: 'ai' | 'human';
  @Column('uuid', { name: 'author_id', nullable: true }) authorId: string | null;
  @Column('text') title: string;
  @Column('jsonb') body: ScriptBody;
  @Column('char', { name: 'content_hash', length: 64 }) contentHash: string;
  @Column('int', { name: 'word_count' }) wordCount: number;
  @Column('int', { name: 'est_duration_sec' }) estDurationSec: number;
  @Column('text', { name: 'llm_model', nullable: true }) llmModel: string | null;
  @Column('text', { name: 'prompt_ref', nullable: true }) promptRef: string | null;
  @Column('boolean', { name: 'llm_mock', nullable: true }) llmMock: boolean | null;
  @Column('text', { name: 'fact_check_state', default: 'pending' }) factCheckState: CheckState;
  @Column('text', { name: 'quality_state', default: 'pending' }) qualityState: CheckState;
  @Column('text', { name: 'code_state', default: 'pending' }) codeState: CheckState;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity('script_claim')
export class ScriptClaimEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'script_version_id' }) scriptVersionId: string;
  @Column('int', { name: 'scene_index' }) sceneIndex: number;
  @Column('text') text: string;
  @Column('text', { default: 'pending' }) verdict: ClaimVerdict;
  @Column('text', { nullable: true }) evidence: string | null;
  @Column('jsonb', { name: 'source_ref', nullable: true }) sourceRef: SourceRef | null;
  @Column('text', { name: 'override_reason', nullable: true }) overrideReason: string | null;
  @Column('uuid', { name: 'overridden_by', nullable: true }) overriddenBy: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity('code_verification')
export class CodeVerificationEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'script_version_id' }) scriptVersionId: string;
  @Column('int', { name: 'scene_index' }) sceneIndex: number;
  @Column('text') language: CodeLanguage;
  @Column('char', { name: 'code_hash', length: 64 }) codeHash: string;
  @Column('text') status: CodeCheckStatus;
  @Column('text', { default: '' }) stdout: string;
  @Column('text', { default: '' }) stderr: string;
  @Column('int', { name: 'duration_ms', nullable: true }) durationMs: number | null;
  @Column('text', { name: 'override_reason', nullable: true }) overrideReason: string | null;
  @Column('uuid', { name: 'overridden_by', nullable: true }) overriddenBy: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

@Entity('script_review')
export class ScriptReviewEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid', { name: 'script_version_id' }) scriptVersionId: string;
  @Column('text') kind: 'ai_quality' | 'human';
  @Column('jsonb', { nullable: true }) scores: Record<QualityDimension, number> | null;
  @Column('text', { array: true, default: () => "'{}'" }) issues: string[];
  @Column('text', { nullable: true }) decision: 'approved' | 'rejected' | 'changes_requested' | null;
  @Column('text', { nullable: true }) note: string | null;
  @Column('uuid', { name: 'reviewer_id', nullable: true }) reviewerId: string | null;
  @Column('char', { name: 'approved_hash', length: 64, nullable: true }) approvedHash: string | null;
  @Column('text', { name: 'llm_model', nullable: true }) llmModel: string | null;
  @Column('text', { name: 'prompt_ref', nullable: true }) promptRef: string | null;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' }) createdAt: Date;
}

export const CONTENT_ENTITIES = [
  ContentIdeaEntity,
  VideoScriptEntity,
  ScriptVersionEntity,
  ScriptClaimEntity,
  CodeVerificationEntity,
  ScriptReviewEntity,
];
