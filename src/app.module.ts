import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { SpacemanModule } from './logic-apps/Spaceman/spaceman.module';
import { GamesModule } from './games/games.module';
import { BookmakersModule } from './games/bookmakers/bookmakers.module';
import { AviatorModule } from './logic-apps/Aviator/aviator.module';
import { RouletteModule } from './logic-apps/Roulettes/roulette.module';
import { PredictorModule } from './services/predictor/predictor.module';

import { User } from './entities/user.entity';
import { Game } from './entities/game.entity';
import { Bookmaker } from './entities/bookmaker.entity';
import { AviatorWs } from './entities/aviator-ws.entity';
import { AviatorRound } from './entities/aviator-round.entity';
import { RouletteRound } from './entities/roulette-round.entity';
import { RouletteWs } from './entities/roulette-ws.entity';
import { Spaceman } from './entities/spaceman.entity';
import { SpacemanRound } from './entities/spaceman-round.entity';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: 'config.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get('DB_HOST'),
        port: configService.get('DB_PORT'),
        username: configService.get('DB_USERNAME'),
        password: configService.get('DB_PASSWORD'),
        database: configService.get('DB_DATABASE'),
        entities: [User, Game, Bookmaker, AviatorWs, AviatorRound, RouletteRound, RouletteWs, Spaceman, SpacemanRound],
        synchronize: configService.get('NODE_ENV') === 'development',
      }),
      inject: [ConfigService],
    }),
    AuthModule,
    AdminModule,
    SpacemanModule,
    GamesModule,
    BookmakersModule,
    AviatorModule,
    RouletteModule,
    PredictorModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
