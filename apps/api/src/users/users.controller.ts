import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import type { CreateUserRequest, UserDto, UserRole } from '@vsf/contracts';
import { AuthUser, CurrentUser, Roles } from '../common/auth-user';
import { UsersService } from './users.service';

export class CreateUserBody implements CreateUserRequest {
  @IsEmail() @MaxLength(254) email: string;
  @IsString() @MinLength(12) @MaxLength(128) password: string;
  @IsIn(['owner', 'reviewer']) role: UserRole;
}

@ApiTags('users')
@ApiBearerAuth()
@Roles('owner')
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<UserDto[]> {
    return this.users.list(user.workspaceId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: CreateUserBody): Promise<UserDto> {
    return this.users.create(body, user.workspaceId);
  }
}
