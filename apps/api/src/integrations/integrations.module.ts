import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ConnectedAccountDto } from '@vsf/contracts';
import { AuthUser, CurrentUser } from '../common/auth-user';
import { ConnectedAccountEntity } from '../database/entities';

/**
 * Connected external accounts. Phase 01 is read-only; the YouTube OAuth flow with encrypted token
 * storage arrives in Phase 05 (tokens never appear in this DTO).
 */
@Injectable()
export class IntegrationsService {
  constructor(
    @InjectRepository(ConnectedAccountEntity) private readonly repo: Repository<ConnectedAccountEntity>,
  ) {}

  async list(workspaceId: string): Promise<ConnectedAccountDto[]> {
    const rows = await this.repo.find({ where: { workspaceId }, order: { createdAt: 'ASC' } });
    return rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      externalAccountId: r.externalAccountId,
      displayName: r.displayName,
      scopes: r.scopes,
      status: r.status,
      connectedAt: r.createdAt.toISOString(),
    }));
  }
}

@ApiTags('integrations')
@ApiBearerAuth()
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ConnectedAccountDto[]> {
    return this.integrations.list(user.workspaceId);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([ConnectedAccountEntity])],
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
})
export class IntegrationsModule {}
