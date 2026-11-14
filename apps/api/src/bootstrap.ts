import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppConfigService } from './config/config';

/** Shared HTTP setup for main.ts and the e2e tests, so tests exercise the real middleware stack. */
export function configureApp(app: INestApplication): void {
  const config = app.get<AppConfigService>(ConfigService);

  const trustProxy = config.get('TRUST_PROXY', { infer: true });
  if (trustProxy !== 'false') {
    // Needed behind nginx so req.ip (rate limiting, audit) is the client, not the proxy.
    (app as NestExpressApplication).set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }

  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config
      .get('CORS_ORIGINS', { infer: true })
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Correlation-Id'],
    exposedHeaders: ['X-Correlation-Id'],
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, stopAtFirstError: false }),
  );
  app.enableShutdownHooks();

  const swagger = config.get('SWAGGER_ENABLED', { infer: true });
  if (swagger && config.get('NODE_ENV', { infer: true }) !== 'production') {
    const doc = new DocumentBuilder()
      .setTitle('Viral Shorts Factory API')
      .setVersion(config.get('APP_VERSION', { infer: true }))
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
  }
}
