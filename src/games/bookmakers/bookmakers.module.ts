import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookmakersService } from './bookmakers.service';
import { BookmakersController } from './bookmakers.controller';
import { Bookmaker } from '../../entities/bookmaker.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Bookmaker])],
  controllers: [BookmakersController],
  providers: [BookmakersService],
  exports: [BookmakersService],
})
export class BookmakersModule {}
