import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { PredictorService } from './predictor.service';

@Module({
  imports: [HttpModule, ConfigModule],
  providers: [PredictorService],
  exports: [PredictorService],
})
export class PredictorModule {}
