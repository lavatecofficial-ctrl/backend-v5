import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { AviatorWebSocketService } from './aviator-websocket.service';
import { AviatorGateway } from '../../gateways/aviator.gateway';
import { AviatorService } from './aviator.service';
import { AviatorHistoryService } from './aviator-history.service';
import { PredictorService, RoundDto } from '../../services/predictor/predictor.service';

@Controller('aviator')
export class AviatorController {
  constructor(
    private readonly aviatorWebSocketService: AviatorWebSocketService,
    private readonly aviatorGateway: AviatorGateway,
    private readonly aviatorService: AviatorService,
    private readonly aviatorHistoryService: AviatorHistoryService,
    private readonly predictorService: PredictorService,
  ) {}

  @Get('connections')
  getConnections() {
    try {
      const connections = this.aviatorWebSocketService.getConnectionsStatus();
      return {
        success: true,
        message: 'Estado de conexiones WebSocket',
        data: connections,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Error al obtener estado de conexiones',
        data: null,
      };
    }
  } // <--- Agregada llave de cierre

  @Post('predict/:bookmakerId')
  async predictFromDb(
    @Param('bookmakerId') bookmakerId: string,
    @Body() body: { limit?: number },
  ) {
    try {
      const id = parseInt(bookmakerId);
      const limit = Math.max(1, Math.min(5000, body?.limit ?? 200));

      // 1) Traer últimas N rondas (DESC) y ordenarlas ASC para el modelo
      const recent = await this.aviatorHistoryService.getRecentRounds(id, limit);
      const ordered = [...recent].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

      // 2) Mapear a RoundDto esperado por el predictor
      const rounds: RoundDto[] = ordered.map(r => ({
        bookmaker_id: id,
        round_id: r.roundId,
        total_bet_amount: r.totalBetAmount,
        total_cashout: r.totalCashout,
        casino_profit: r.casinoProfit,
        max_multiplier: r.maxMultiplier,
        online_players: r.onlinePlayers,
        bets_count: r.betsCount,
      }));

      // 3) Llamar al predictor
      const prediction = await this.predictorService.predictAviator(rounds, id);

      return {
        success: true,
        message: 'Predicción generada desde la base de datos',
        data: prediction,
        meta: { rounds_sent: rounds.length, bookmakerId: id },
      };
    } catch (error: any) {
      return {
        success: false,
        message: error?.message || 'Error al generar predicción',
        error,
      };
    }
  }

  @Get('history/:bookmakerId')
  async getHistory(
    @Param('bookmakerId') bookmakerId: string,
  ) {
    try {
      const id = parseInt(bookmakerId);
      const limit = 100;

      const rounds = await this.aviatorHistoryService.getRecentRounds(id, limit);

      return {
        success: true,
        message: `Últimas ${rounds.length} rondas obtenidas`,
        data: rounds,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Error al obtener historial',
        data: [],
      };
    }
  }

  @Get('connections/status')
  getConnectionsStatus() {
    try {
      const connections = this.aviatorWebSocketService.getConnectionsStatus();
      return {
        success: true,
        message: 'Estado de conexiones WebSocket',
        data: connections,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Error al obtener estado de conexiones',
        data: null,
      };
    }
  }

  @Post('start')
  async startService() {
    try {
      await this.aviatorWebSocketService.initializeConnections(this.aviatorGateway.getServer());
      
      // Esperar un momento para que las conexiones se establezcan
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      return {
        message: 'Servicio de Aviator iniciado correctamente',
        timestamp: new Date().toISOString(),
        status: 'success'
      };
    } catch (error) {
      return {
        message: 'Error al iniciar el servicio de Aviator',
        error: error.message,
        timestamp: new Date().toISOString(),
        status: 'error'
      };
    }
  }

  @Post('test-multiplier/:bookmakerId')
  testMultiplier(@Param('bookmakerId') bookmakerId: string) {
    const id = parseInt(bookmakerId);
    const testData = {
      current_multiplier: Math.random() * 10 + 1, // Multiplicador aleatorio entre 1-11
    };
    
    this.aviatorGateway.emitMultiplier(id, testData);
    
    return {
      message: 'Datos de prueba enviados',
      bookmakerId: id,
      data: testData,
    };
  }

  @Post('test-round/:bookmakerId')
  testRound(@Param('bookmakerId') bookmakerId: string) {
    const id = parseInt(bookmakerId);
    const testData = {
      online_players: Math.floor(Math.random() * 100) + 10,
      bets_count: Math.floor(Math.random() * 50) + 5,
      total_bet_amount: Math.random() * 10000 + 1000,
      total_cashout: Math.random() * 5000 + 500,
      current_multiplier: Math.random() * 10 + 1,
      max_multiplier: Math.random() * 15 + 1,
      game_state: 'Run' as const,
      round_id: `test-${Date.now()}`,
      casino_profit: Math.random() * 2000 + 100,
    };
    
    this.aviatorGateway.emitRoundData(id, testData);
    
    return {
      message: 'Datos de ronda de prueba enviados',
      bookmakerId: id,
      data: testData,
    };
  }

  @Get('bookmaker/:bookmakerId')
  async getBookmakerInfo(@Param('bookmakerId') bookmakerId: string) {
    try {
      const id = parseInt(bookmakerId);
      const aviatorWs = await this.aviatorService.findByBookmakerId(id);
      
      if (!aviatorWs) {
        return {
          success: false,
          message: 'Aviator WebSocket no encontrado para este bookmaker',
        };
      }

              return {
          success: true,
          data: {
            id: aviatorWs.id,
            bookmakerId: aviatorWs.bookmakerId,
            gameId: aviatorWs.gameId,
            urlWebsocket: aviatorWs.url_websocket,
            apiMessage: aviatorWs.api_message,
            authMessage: aviatorWs.auth_message,
            pingMessage: aviatorWs.ping_message,
            statusWs: aviatorWs.status_ws,
            createdAt: aviatorWs.created_at,
            updatedAt: aviatorWs.updated_at,
            bookmaker: aviatorWs.bookmaker,
            game: aviatorWs.game,
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
      const updated = await this.aviatorService.updateWebSocketUrl(id, body.url);
      
      return {
        success: true,
        message: 'URL WebSocket actualizada correctamente',
        data: {
          id: updated.id,
          bookmakerId: updated.bookmakerId,
          urlWebsocket: updated.url_websocket,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Error al actualizar la URL WebSocket',
      };
    }
  }

  @Post('bookmaker/:bookmakerId/auth-message')
  async updateAuthMessage(
    @Param('bookmakerId') bookmakerId: string,
    @Body() body: { authMessage: string },
  ) {
    try {
      const id = parseInt(bookmakerId);
      const updated = await this.aviatorService.updateAuthMessage(id, body.authMessage);
      
      return {
        success: true,
        message: 'Mensaje de autenticación actualizado correctamente',
        data: {
          id: updated.id,
          bookmakerId: updated.bookmakerId,
          authMessage: updated.auth_message,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Error al actualizar el mensaje de autenticación',
      };
    }
  }

  @Post('bookmaker/:bookmakerId/status')
  async updateWebSocketStatus(
    @Param('bookmakerId') bookmakerId: string,
    @Body() body: { status: string },
  ) {
    try {
      const id = parseInt(bookmakerId);
      const updated = await this.aviatorService.updateWebSocketStatus(id, body.status);
      
      return {
        success: true,
        message: 'Estado del WebSocket actualizado correctamente',
        data: {
          id: updated.id,
          bookmakerId: updated.bookmakerId,
          statusWs: updated.status_ws,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Error al actualizar el estado del WebSocket',
      };
    }
  }
}
