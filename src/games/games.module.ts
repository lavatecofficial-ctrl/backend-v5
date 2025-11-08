import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { GamesService } from './games.service';
import { GamesController } from './games.controller';
import { Game } from '../entities/game.entity';
import { AviatorGateway } from '../gateways/aviator.gateway';
import { RouletteGateway } from '../gateways/roulette.gateway';
import { AviatorHistoryService } from '../logic-apps/Aviator/aviator-history.service';
import { RouletteHistoryService } from '../logic-apps/Roulettes/roulette-history.service';
import { AviatorRound } from '../entities/aviator-round.entity';
import { RouletteRound } from '../entities/roulette-round.entity';
import { Bookmaker } from '../entities/bookmaker.entity';


@Module({
  imports: [
    TypeOrmModule.forFeature([Game, AviatorRound, RouletteRound, Bookmaker]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: '24h',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    GamesService,
    AviatorGateway,
    RouletteGateway,
    AviatorHistoryService,
    RouletteHistoryService,
  ],
  controllers: [GamesController],
  exports: [
    GamesService,
    AviatorGateway,
    RouletteGateway,
  ],
})
export class GamesModule {}
