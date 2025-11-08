import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { GamesService } from './games.service';
import { Game } from '../entities/game.entity';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('games')
export class GamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Get()
  async findAll(): Promise<Game[]> {
    return this.gamesService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<Game | null> {
    return this.gamesService.findOne(+id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  async create(@Body() gameData: Partial<Game>): Promise<Game> {
    return this.gamesService.create(gameData);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() gameData: Partial<Game>): Promise<Game | null> {
    return this.gamesService.update(+id, gameData);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string): Promise<void> {
    return this.gamesService.remove(+id);
  }

  @Put(':id/toggle')
  @UseGuards(JwtAuthGuard)
  async toggleActive(@Param('id') id: string): Promise<Game | null> {
    return this.gamesService.toggleActive(+id);
  }

  @Get('websocket/status')
  @UseGuards(JwtAuthGuard)
  async getWebSocketStatus() {
    return {
      status: 'success',
      data: {
        aviator: this.gamesService.getAviatorWebSocketStatus(),
        roulette: this.gamesService.getRouletteWebSocketStatus(),
        timestamp: new Date().toISOString()
      }
    };
  }

  @Post('websocket/cleanup')
  @UseGuards(JwtAuthGuard)
  async cleanupWebSocketConnections() {
    const result = {
      aviator: this.gamesService.cleanupAviatorConnections(),
      roulette: this.gamesService.cleanupRouletteConnections(),
      timestamp: new Date().toISOString()
    };

    return {
      status: 'success',
      message: 'Limpieza de conexiones WebSocket completada',
      data: result
    };
  }

  @Get('websocket/test')
  async testWebSocket() {
    return {
      status: 'success',
      message: 'WebSocket endpoints are available',
      data: {
        aviator: '/aviator',
        roulette: '/roulette',
        timestamp: new Date().toISOString(),
      }
    };
  }
}
