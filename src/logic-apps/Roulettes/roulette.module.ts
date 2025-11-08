import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RouletteRound } from '../../entities/roulette-round.entity';
import { RouletteWs } from '../../entities/roulette-ws.entity';
import { Bookmaker } from '../../entities/bookmaker.entity';
import { RouletteHistoryService } from './roulette-history.service';
import { RouletteWebSocketService } from './roulette-websocket.service';
import { RouletteService } from './roulette.service';

import { RouletteController } from './roulette.controller';
import { GamesModule } from '../../games/games.module';
import { PredictorModule } from '../../services/predictor/predictor.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RouletteRound, RouletteWs, Bookmaker]),
    GamesModule,
    PredictorModule,
  ],
  controllers: [RouletteController],
  providers: [
    RouletteHistoryService,
    RouletteWebSocketService,
    RouletteService,
  ],
  exports: [
    RouletteHistoryService,
    RouletteWebSocketService,
    RouletteService,
  ],
})
export class RouletteModule {}
