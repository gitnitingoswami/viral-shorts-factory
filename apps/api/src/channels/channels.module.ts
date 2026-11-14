import { Body, Controller, ConflictException, Get, Injectable, Module, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Repository } from 'typeorm';
import type { ChannelDto, CreateChannelRequest, Platform } from '@vsf/contracts';
import { AuthUser, CurrentUser, Roles } from '../common/auth-user';
import { ChannelEntity } from '../database/entities';

export class CreateChannelBody implements CreateChannelRequest {
  @IsIn(['youtube']) platform: Platform;
  /** YouTube handle, e.g. "@Codehaksy". */
  @IsString() @Matches(/^@[A-Za-z0-9._-]{3,30}$/, { message: 'handle must look like @name (3-30 chars)' }) handle: string;
  @IsString() @MinLength(1) @MaxLength(100) title: string;
}

export function toChannelDto(c: ChannelEntity): ChannelDto {
  return {
    id: c.id,
    platform: c.platform,
    handle: c.handle,
    title: c.title,
    defaultPrivacy: c.defaultPrivacy,
    createdAt: c.createdAt.toISOString(),
  };
}

@Injectable()
export class ChannelsService {
  constructor(@InjectRepository(ChannelEntity) private readonly repo: Repository<ChannelEntity>) {}

  async list(workspaceId: string): Promise<ChannelDto[]> {
    const rows = await this.repo.find({ where: { workspaceId }, order: { createdAt: 'ASC' } });
    return rows.map(toChannelDto);
  }

  async create(workspaceId: string, body: CreateChannelRequest): Promise<ChannelDto> {
    const exists = await this.repo.exists({ where: { workspaceId, platform: body.platform, handle: body.handle } });
    if (exists) throw new ConflictException('Channel already exists');
    // New channels always default to private publishing (see SECURITY_DESIGN.md T5).
    const saved = await this.repo.save(this.repo.create({ ...body, workspaceId, defaultPrivacy: 'private' }));
    return toChannelDto(saved);
  }
}

@ApiTags('channels')
@ApiBearerAuth()
@Controller('channels')
export class ChannelsController {
  constructor(private readonly channels: ChannelsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<ChannelDto[]> {
    return this.channels.list(user.workspaceId);
  }

  @Roles('owner')
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateChannelBody): Promise<ChannelDto> {
    return this.channels.create(user.workspaceId, body);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([ChannelEntity])],
  controllers: [ChannelsController],
  providers: [ChannelsService],
  exports: [ChannelsService],
})
export class ChannelsModule {}
