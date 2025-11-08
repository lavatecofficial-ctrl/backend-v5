import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RouletteWebSocketService } from './roulette-websocket.service';
import { RouletteHistoryService } from './roulette-history.service';
import { RouletteGateway } from '../../gateways/roulette.gateway';
import { RouletteService } from './roulette.service';


@Controller('roulette')
@UseGuards(JwtAuthGuard)
export class RouletteController {
  constructor(
    private rouletteWebSocketService: RouletteWebSocketService,
    private rouletteHistoryService: RouletteHistoryService,
    private readonly rouletteGateway: RouletteGateway,
    private readonly rouletteService: RouletteService,
  ) {}

  @Get('status')
  async getConnectionsStatus() {
    return {
      status: 'success',
      data: this.rouletteWebSocketService.getConnectionsStatus()
    };
  }

  @Post('start')
  async startService() {
    try {
      await this.rouletteWebSocketService.stopAllConnections();
      await this.rouletteWebSocketService.initializeConnections(null);
      return {
        success: true,
        message: 'Servicio de Roulettes iniciado correctamente',
        timestamp: new Date().toISOString(),
        status: 'success'
      };
    } catch (error) {
      return {
        success: false,
        message: 'Error al iniciar el servicio de Roulettes',
        error: error.message,
        timestamp: new Date().toISOString(),
        status: 'error'
      };
    }
  }

  @Post('stop')
  async stopService() {
    try {
      await this.rouletteWebSocketService.stopAllConnections();
      return {
        success: true,
        message: 'Servicio de Roulettes detenido correctamente',
        timestamp: new Date().toISOString(),
        status: 'success'
      };
    } catch (error) {
      return {
        success: false,
        message: 'Error al detener el servicio de Roulettes',
        error: error.message,
        timestamp: new Date().toISOString(),
        status: 'error'
      };
    }
  }

  @Get('history/:bookmakerId')
  async getHistory(@Param('bookmakerId') bookmakerId: string) {
    try {
      const history = await this.rouletteHistoryService.getRecentRounds(
        parseInt(bookmakerId), 
        500
      );
      return {
        status: 'success',
        data: history
      };
    } catch (error) {
      return {
        status: 'error',
        message: 'Error obteniendo historial de ruleta',
        error: error.message
      };
    }
  }

  @Post('reset-connections')
  async resetConnections() {
    try {
      await this.rouletteWebSocketService.resetAllConnections();
      return {
        status: 'success',
        message: 'Conexiones de ruleta reseteadas correctamente'
      };
    } catch (error) {
      return {
        status: 'error',
        message: 'Error reseteando conexiones',
        error: error.message
      };
    }
  }

  @Get('stats/:bookmakerId')
  async getStats(@Param('bookmakerId') bookmakerId: string) {
    try {
      const history = await this.rouletteHistoryService.getRecentRounds(
        parseInt(bookmakerId), 
        1000
      );

      // Calcular estadísticas básicas
      const stats = {
        totalRounds: history.length,
        colors: { red: 0, black: 0, green: 0 },
        numbers: Array(37).fill(0), // 0-36
        lastUpdate: history[0]?.timestamp || null
      };

      history.forEach(round => {
        // Contar colores
        if (round.color === 'Red') stats.colors.red++;
        else if (round.color === 'Black') stats.colors.black++;
        else if (round.color === 'Green') stats.colors.green++;

        // Contar números
        if (round.number >= 0 && round.number <= 36) {
          stats.numbers[round.number]++;
        }
      });

      return {
        status: 'success',
        data: stats
      };
    } catch (error) {
      return {
        status: 'error',
        message: 'Error obteniendo estadísticas',
        error: error.message
      };
    }
  }

  @Get('bookmaker/:bookmakerId')
  async getBookmakerInfo(@Param('bookmakerId') bookmakerId: string) {
    try {
      const id = parseInt(bookmakerId);
      const rouletteWs = await this.rouletteService.findByBookmakerId(id);
      
      if (!rouletteWs) {
        return {
          success: false,
          message: 'Roulette WebSocket no encontrado para este bookmaker',
        };
      }

      return {
        success: true,
        data: {
          id: rouletteWs.id,
          bookmakerId: rouletteWs.bookmakerId,
          gameId: rouletteWs.gameId,
          page: rouletteWs.page,
          createdAt: rouletteWs.createdAt,
          bookmaker: rouletteWs.bookmaker,
          game: rouletteWs.game,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Error al obtener información del bookmaker',
      };
    }
  }

  @Post('bookmaker/:bookmakerId/websocket-url')
  async updateWebSocketUrl(
    @Param('bookmakerId') bookmakerId: string,
    @Body() body: { url: string },
  ) {
    try {
      const id = parseInt(bookmakerId);
      const updated = await this.rouletteService.updateWebSocketUrl(id, body.url);
      
      return {
        success: true,
        message: 'URL WebSocket actualizada correctamente',
        data: {
          id: updated.id,
          bookmakerId: updated.bookmakerId,
          page: updated.page,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Error al actualizar la URL WebSocket',
      };
    }
  }
}
