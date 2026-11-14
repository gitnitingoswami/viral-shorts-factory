import { ConflictException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import type { UserDto, UserRole } from '@vsf/contracts';
import { AuditService } from '../audit/audit.service';
import { DEFAULT_WORKSPACE_ID } from '../common/constants';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env.schema';
import { UserAccountEntity } from '../database/entities';

/** OWASP-recommended argon2id parameters (memory 64 MiB, 3 iterations). */
export const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export function toUserDto(u: UserAccountEntity): UserDto {
  return { id: u.id, email: u.email, role: u.role, createdAt: u.createdAt.toISOString() };
}

@Injectable()
export class UsersService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(UserAccountEntity) private readonly repo: Repository<UserAccountEntity>,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppEnv, true>,
  ) {}

  /** Creates the first owner from BOOTSTRAP_OWNER_* only when the user table is empty. */
  async onApplicationBootstrap(): Promise<void> {
    const c = this.config;
    const email = c.get('BOOTSTRAP_OWNER_EMAIL', { infer: true });
    const password = c.get('BOOTSTRAP_OWNER_PASSWORD', { infer: true });
    if (!email || !password) return;
    if ((await this.repo.count()) > 0) return;
    const user = await this.create({ email, password, role: 'owner' });
    await this.audit.record({ actorType: 'system', action: 'user.bootstrap_owner', subjectType: 'user', subjectId: user.id, outcome: 'success' });
    this.logger.warn('Bootstrapped the first owner account. Clear BOOTSTRAP_OWNER_* from the environment now.');
  }

  async create(input: { email: string; password: string; role: UserRole }, workspaceId = DEFAULT_WORKSPACE_ID): Promise<UserDto> {
    const email = input.email.trim().toLowerCase();
    const exists = await this.repo.exists({ where: { workspaceId, email } });
    if (exists) throw new ConflictException('A user with this email already exists');
    const saved = await this.repo.save(
      this.repo.create({ workspaceId, email, role: input.role, passwordHash: await hashPassword(input.password) }),
    );
    return toUserDto(saved);
  }

  async list(workspaceId: string): Promise<UserDto[]> {
    const rows = await this.repo.find({ where: { workspaceId }, order: { createdAt: 'ASC' } });
    return rows.map(toUserDto);
  }

  findById(id: string): Promise<UserAccountEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  /** Includes the password hash; only for credential verification. */
  findForLogin(email: string, workspaceId = DEFAULT_WORKSPACE_ID): Promise<UserAccountEntity | null> {
    return this.repo
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .where('u.workspace_id = :workspaceId AND u.email = :email', { workspaceId, email: email.trim().toLowerCase() })
      .getOne();
  }
}
