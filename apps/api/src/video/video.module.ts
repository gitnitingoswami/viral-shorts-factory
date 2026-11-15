import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BudgetCoreModule } from '../budget/budget.module';
import type { AppEnv } from '../config/env.schema';
import { JobsCoreModule } from '../jobs/jobs.module';
import { MediaAssetsService } from './media-assets.service';
import { EspeakTtsProvider, MockTtsProvider } from './tts';
import { TTS_PROVIDERS, TtsProviders, VideoPipeline } from './video.pipeline';
import { VideoController } from './video.controller';
import { VideoProcessor } from './video.processor';
import { VideoService } from './video.service';

export const ttsProvidersFactory = {
  provide: TTS_PROVIDERS,
  inject: [ConfigService],
  useFactory: (config: ConfigService<AppEnv, true>): TtsProviders => ({
    espeak: new EspeakTtsProvider(config.get('ESPEAK_PATH', { infer: true })),
    mock: new MockTtsProvider(),
  }),
};

/** Shared video services (API + worker). */
@Module({
  imports: [JobsCoreModule, BudgetCoreModule],
  providers: [ttsProvidersFactory, MediaAssetsService, VideoPipeline, VideoService],
  exports: [MediaAssetsService, VideoPipeline, VideoService, TTS_PROVIDERS],
})
export class VideoCoreModule {}

@Module({ imports: [VideoCoreModule], controllers: [VideoController] })
export class VideoModule {}

@Module({ imports: [VideoCoreModule, JobsCoreModule], providers: [VideoProcessor] })
export class VideoWorkerModule {}
