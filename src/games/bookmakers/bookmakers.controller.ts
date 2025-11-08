import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { BookmakersService } from './bookmakers.service';
import { Bookmaker } from '../../entities/bookmaker.entity';

@Controller('bookmakers')
export class BookmakersController {
  constructor(private readonly bookmakersService: BookmakersService) {}

  @Get()
  findAll(): Promise<Bookmaker[]> {
    return this.bookmakersService.findAll();
  }

  @Get('game/:gameId')
  findByGameId(@Param('gameId') gameId: string): Promise<Bookmaker[]> {
    return this.bookmakersService.findByGameId(+gameId);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Promise<Bookmaker | null> {
    return this.bookmakersService.findOne(+id);
  }

  @Post()
  create(@Body() createBookmakerDto: {
    gameId: number;
    bookmaker: string;
    bookmakerImg: string;
  }): Promise<Bookmaker> {
    return this.bookmakersService.create(createBookmakerDto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateBookmakerDto: {
      gameId?: number;
      bookmaker?: string;
      bookmakerImg?: string;
    },
  ): Promise<Bookmaker | null> {
    return this.bookmakersService.update(+id, updateBookmakerDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string): Promise<void> {
    return this.bookmakersService.remove(+id);
  }
}
