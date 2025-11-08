import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SpacemanService } from './spaceman.service';
import { SpacemanWebSocketService } from './spaceman-websocket.service';
import { SpacemanTokenService } from './spaceman-token.service';
import { SpacemanController } from './spaceman.controller';
import { SpacemanGateway } from './spaceman.gateway';
import { Spaceman } from '../../entities/spaceman.entity';
import { SpacemanRound } from '../../entities/spaceman-round.entity';
import { PredictorModule } from '../../services/predictor/predictor.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Spaceman, SpacemanRound]),
    PredictorModule,
  ],
  controllers: [SpacemanController],
  providers: [SpacemanService, SpacemanWebSocketService, SpacemanTokenService, SpacemanGateway],
  exports: [SpacemanService, SpacemanWebSocketService, SpacemanTokenService],
})
export class SpacemanModule {}
