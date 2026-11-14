import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigService } from '../config/config';
import { RefreshSessionEntity, UserAccountEntity } from '../database/entities';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CsrfHeaderGuard, JwtAuthGuard, RolesGuard } from './guards';

@Module({
  imports: [
    UsersModule,
    TypeOrmModule.forFeature([UserAccountEntity, RefreshSessionEntity]),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: AppConfigService) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: { algorithm: 'HS256', issuer: 'vsf-api', audience: 'vsf-web' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'vsf-api', audience: 'vsf-web' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard, CsrfHeaderGuard],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
