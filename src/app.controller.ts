import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { AviatorWebSocketService } from './logic-apps/Aviator/aviator-websocket.service';
import { GoBetWebSocketService } from './logic-apps/Aviator/gobet-websocket.service';
import { RouletteWebSocketService } from './logic-apps/Roulettes/roulette-websocket.service';
import { SpacemanWebSocketService } from './logic-apps/Spaceman/spaceman-websocket.service';
import { AviatorGateway } from './gateways/aviator.gateway';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly aviatorWebSocketService: AviatorWebSocketService,
    private readonly goBetWebSocketService: GoBetWebSocketService,
    private readonly rouletteWebSocketService: RouletteWebSocketService,
    private readonly spacemanWebSocketService: SpacemanWebSocketService,
    private readonly aviatorGateway: AviatorGateway,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Post('services/start-all')
  // @UseGuards(JwtAuthGuard) // Temporalmente deshabilitado para testing
  async startAllServices() {
    console.log('🚀 [BACKEND] Endpoint /services/start-all llamado');
    try {
      const results: {
        aviator: { status: string; message: string } | null;
        roulette: { status: string; message: string } | null;
        spaceman: { status: string; message: string } | null;
      } = {
        aviator: null,
        roulette: null,
        spaceman: null
      };

      // Iniciar Aviator (ambos servicios: wss:// y ws://)
      console.log('🎮 [BACKEND] Iniciando servicios Aviator...');
      try {
        const server = this.aviatorGateway.getServer();
        console.log('🎮 [BACKEND] Gateway server:', server ? 'OK' : 'NULL');
        
        // Iniciar servicio wss:// (888starz, etc)
        await this.aviatorWebSocketService.initializeConnections(server);
        console.log('✅ [BACKEND] Aviator WSS iniciado correctamente');
        
        // Iniciar servicio ws:// (GoBet)
        await this.goBetWebSocketService.initializeConnections(server);
        console.log('✅ [BACKEND] GoBet WS iniciado correctamente');
        
        results.aviator = { status: 'success', message: 'Servicios Aviator (wss:// + GoBet) iniciados correctamente' };
      } catch (error) {
        console.error('❌ [BACKEND] Error al iniciar Aviator:', error);
        results.aviator = { status: 'error', message: error.message };
      }

      // Iniciar Roulette
      try {
        await this.rouletteWebSocketService.initializeConnections(null);
        results.roulette = { status: 'success', message: 'Servicio iniciado correctamente' };
      } catch (error) {
        results.roulette = { status: 'error', message: error.message };
      }

      // Iniciar Spaceman
      try {
        await this.spacemanWebSocketService.initializeConnections(null);
        results.spaceman = { status: 'success', message: 'Servicio iniciado correctamente' };
      } catch (error) {
        results.spaceman = { status: 'error', message: error.message };
      }

      return {
        message: 'Inicialización de servicios completada',
        timestamp: new Date().toISOString(),
        results
      };
    } catch (error) {
      return {
        message: 'Error al iniciar servicios',
        error: error.message,
        timestamp: new Date().toISOString(),
        status: 'error'
      };
    }
  }

  @Get('services/status')
  @UseGuards(JwtAuthGuard)
  async getServicesStatus() {
    try {
      const aviatorStatus = this.aviatorWebSocketService.getConnectionsStatus();
      const rouletteStatus = this.rouletteWebSocketService.getConnectionsStatus();
      
      // Spaceman usa un método diferente, obtener estado general
      const spacemanStatus = {
        message: 'Estado de conexiones Spaceman',
        timestamp: new Date().toISOString()
      };

      return {
        message: 'Estado de todos los servicios WebSocket',
        timestamp: new Date().toISOString(),
        services: {
          aviator: aviatorStatus,
          roulette: rouletteStatus,
          spaceman: spacemanStatus
        }
      };
    } catch (error) {
      return {
        message: 'Error al obtener estado de servicios',
        error: error.message,
        timestamp: new Date().toISOString(),
        status: 'error'
      };
    }
  }
}
