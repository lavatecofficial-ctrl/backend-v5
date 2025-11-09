import { 
  Controller, 
  Get, 
  Post,
  Patch,
  Body,
  Param,
  Query
} from '@nestjs/common';
import { SpacemanWebSocketService } from './spaceman-websocket.service';
import { SpacemanService } from './spaceman.service';
import { UpdateSessionUrlDto } from './dto/update-session-url.dto';

@Controller('spaceman')
export class SpacemanController {
  constructor(
    private readonly spacemanWebSocketService: SpacemanWebSocketService,
    private readonly spacemanService: SpacemanService,
  ) {}

  /**
   * Iniciar servicio de Spaceman - actualiza tokens e inicia WebSocket
   */
  @Post('start')
  async startService() {
    try {
      // Obtener el servidor Socket.IO del WebSocketService
      const io = this.spacemanWebSocketService.getSocketIO();
      
      if (!io) {
        return {
          success: false,
          message: 'Socket.IO no está configurado. Reinicia el servidor.',
        };
      }

      // FORZAR actualización de tokens antes de inicializar
      this.spacemanWebSocketService.setForceTokenUpdate(true);
      
      // Reiniciar conexiones con tokens actualizados
      await this.spacemanWebSocketService.resetConnections(io);

             // Actualizar timestamp de última actualización de tokens en la base de datos (solo ID 1)
       const currentTime = new Date().toISOString();
       await this.spacemanService.update(1, {
         tokenUpdatedAt: currentTime
       });

      return {
        success: true,
        message: 'Servicio de Spaceman iniciado exitosamente con tokens actualizados',
        data: {
          timestamp: new Date().toISOString(),
          connectionsStatus: this.spacemanWebSocketService.getAllConnectionsStatus(),
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Error iniciando servicio de Spaceman: ${error.message}`,
      };
    }
  }

  /**
   * Listar registros de Spaceman (equivalente a websockets)
   */
  @Get('websockets')
  async getAllWebSockets() {
    try {
      const items = await this.spacemanService.findAll();
      return {
        success: true,
        message: 'Websockets de Spaceman obtenidos',
        data: items.map((ws) => ({
          id: ws.id,
          bookmakerId: ws.bookmakerId,
          gameId: ws.gameId,
          urlSessionid: ws.urlSessionid,
          apiMessage: '',
          authMessage: ws.jsessionid || '',
          pingMessage: '',
          statusWs: ws.statusWs,
          createdAt: ws.created_at,
          updatedAt: ws.updated_at,
          bookmaker: ws.bookmaker,
          game: ws.game,
          isEditable: true,
        })),
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Error al obtener websockets de Spaceman',
        data: [],
      };
    }
  }

  /**
   * Actualizar jsessionid (auth message equivalente) por ID
   */
  @Post('websocket/:id/auth-message')
  async updateAuthMessageById(
    @Param('id') id: string,
    @Body() body: { authMessage: string },
  ) {
    try {
      const updated = await this.spacemanService.updateAuthMessageById(parseInt(id), body.authMessage);
      return {
        success: true,
        message: 'Auth Message (jsessionid) actualizado correctamente',
        data: {
          id: updated.id,
          authMessage: updated.jsessionid,
          updatedAt: updated.updated_at,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Error al actualizar Auth Message',
      };
    }
  }

  /**
   * Actualizar URL de sessionid
   */
  @Patch('session-url')
  async updateSessionUrl(@Body() body: UpdateSessionUrlDto) {
         try {
       // Verificar que existe el spaceman ID 1
       const spaceman = await this.spacemanService.findOne(1);
       
       if (!spaceman) {
         return {
           success: false,
           message: 'No existe el spaceman con ID 1',
         };
       }

       // Actualizar la URL del spaceman ID 1
       const updatedSpaceman = await this.spacemanService.update(1, {
         urlSessionid: body.url
       });

      return {
        success: true,
        message: 'URL de sessionid actualizada exitosamente',
        data: {
          urlSessionid: updatedSpaceman.urlSessionid,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Error actualizando URL de sessionid: ${error.message}`,
      };
    }
  }

  /**
   * Actualizar estado del WebSocket
   */
  @Patch('bookmaker/:bookmakerId/status')
  async updateWebSocketStatus(
    @Param('bookmakerId') bookmakerId: string,
    @Body() body: { status: string },
  ) {
    try {
      const id = parseInt(bookmakerId);
      const updated = await this.spacemanService.updateWebSocketStatus(id, body.status);

      return {
        success: true,
        message: 'Estado del WebSocket actualizado correctamente',
        data: {
          id: updated.id,
          bookmakerId: updated.bookmakerId,
          statusWs: updated.statusWs,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: error.message || 'Error al actualizar el estado del WebSocket',
      };
    }
  }

  /**
   * Crear registro de Spaceman automáticamente si no existe
   */
  @Post('create-default/:bookmakerId')
  async createDefaultSpacemanWithId(@Param('bookmakerId') bookmakerId: string) {
    try {
      const targetBookmakerId = parseInt(bookmakerId);
      
      // Verificar si ya existe un registro para el bookmaker
      const existingSpaceman = await this.spacemanService.findByBookmakerId(targetBookmakerId);
      
      if (existingSpaceman) {
        return {
          success: true,
          message: 'Spaceman ya existe',
          data: existingSpaceman,
        };
      }

      // Crear el registro por defecto
      const spacemanData = {
        gameId: 2, // ID del juego Spaceman
        bookmakerId: targetBookmakerId,
        urlSessionid: 'https://example.com/session',
        jsessionid: 'jsessionid_example',
        broadcasterBase: 'wss://broadcaster.pragmaticplaylive.net/websocket/real',
        financeBase: 'wss://gs9.pragmaticplaylive.net/websocket/finance_real',
        tokenUpdatedAt: new Date().toISOString(),
      };

      const spaceman = await this.spacemanService.create(spacemanData);
      
      return {
        success: true,
        message: 'Spaceman creado exitosamente',
        data: spaceman,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Error al crear Spaceman: ' + error.message,
      };
    }
  }

  /**
   * Crear registro de Spaceman con bookmaker por defecto (ID 1)
   */
  @Post('create-default')
  async createDefaultSpaceman() {
    try {
      const targetBookmakerId = 1;
      
      // Verificar si ya existe un registro para el bookmaker
      const existingSpaceman = await this.spacemanService.findByBookmakerId(targetBookmakerId);
      
      if (existingSpaceman) {
        return {
          success: true,
          message: 'Spaceman ya existe',
          data: existingSpaceman,
        };
      }

      // Crear el registro por defecto
      const spacemanData = {
        gameId: 2, // ID del juego Spaceman
        bookmakerId: targetBookmakerId,
        urlSessionid: 'https://example.com/session',
        jsessionid: 'jsessionid_example',
        broadcasterBase: 'wss://broadcaster.pragmaticplaylive.net/websocket/real',
        financeBase: 'wss://gs9.pragmaticplaylive.net/websocket/finance_real',
        tokenUpdatedAt: new Date().toISOString(),
      };

      const spaceman = await this.spacemanService.create(spacemanData);
      
      return {
        success: true,
        message: 'Spaceman creado exitosamente',
        data: spaceman,
      };
    } catch (error) {
      return {
        success: false,
        message: 'Error al crear Spaceman: ' + error.message,
      };
    }
  }

  /**
   * Actualizar headers de WebSocket
   */
  @Patch(':id/headers')
  async updateHeaders(
    @Param('id') id: string,
    @Body() body: { headers: { broadcaster?: Record<string, string>; finance?: Record<string, string> } }
  ) {
    try {
      const spacemanId = parseInt(id);
      const updated = await this.spacemanService.update(spacemanId, {
        headers: body.headers
      });

      return {
        success: true,
        message: 'Headers actualizados exitosamente',
        data: {
          id: updated.id,
          headers: updated.headers,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Error actualizando headers: ${error.message}`,
      };
    }
  }

  /**
   * Obtener rondas de Spaceman
   */
  @Get('rounds')
  async getRounds(
    @Query('spacemanId') spacemanId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    try {
      const parsedSpacemanId = spacemanId ? parseInt(spacemanId) : undefined;
      const parsedLimit = limit ? parseInt(limit) : 100;
      const parsedOffset = offset ? parseInt(offset) : 0;

      const result = await this.spacemanService.getRounds(
        parsedSpacemanId,
        parsedLimit,
        parsedOffset,
      );

      return {
        success: true,
        message: 'Rondas obtenidas exitosamente',
        data: result,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error obteniendo rondas: ${error.message}`,
      };
    }
  }

  /**
   * Obtener estadísticas de Spaceman
   */
  @Get('stats')
  async getStats(@Query('spacemanId') spacemanId?: string) {
    try {
      const parsedSpacemanId = spacemanId ? parseInt(spacemanId) : undefined;
      const stats = await this.spacemanService.getStats(parsedSpacemanId);

      return {
        success: true,
        message: 'Estadísticas obtenidas exitosamente',
        data: stats,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error obteniendo estadísticas: ${error.message}`,
      };
    }
  }

  /**
   * Obtener últimas rondas de un Spaceman específico
   */
  @Get(':id/latest-rounds')
  async getLatestRounds(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const spacemanId = parseInt(id);
      const parsedLimit = limit ? parseInt(limit) : 10;

      const rounds = await this.spacemanService.getLatestRounds(
        spacemanId,
        parsedLimit,
      );

      return {
        success: true,
        message: 'Últimas rondas obtenidas exitosamente',
        data: rounds,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error obteniendo últimas rondas: ${error.message}`,
      };
    }
  }

  /**
   * Obtener estado del servicio de Spaceman
   */
  @Get('status')
  async getStatus() {
    try {
      const connectionsStatus = this.spacemanWebSocketService.getAllConnectionsStatus();
      const activeConnections = Object.values(connectionsStatus).filter(
        status => status.status === 'CONNECTED'
      ).length;

             // Obtener información de la base de datos (solo del spaceman ID 1)
       const spaceman = await this.spacemanService.findOne(1);
       const lastTokenUpdate = spaceman?.tokenUpdatedAt ? new Date(spaceman.tokenUpdatedAt).getTime() : null;
       
       // Obtener la URL de sessionid del spaceman ID 1
       const sessionUrl = spaceman?.urlSessionid || null;

      return {
        success: true,
        message: 'Estado de Spaceman obtenido exitosamente',
        data: {
          isActive: activeConnections > 0,
          activeConnections,
          totalSpaceman: Object.keys(connectionsStatus).length,
          connectionsStatus,
          timestamp: new Date().toISOString(),
          lastTokenUpdate: lastTokenUpdate ? new Date(lastTokenUpdate).toISOString() : null,
          sessionUrl: sessionUrl,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Error obteniendo estado del servicio: ${error.message}`,
      };
    }
  }
}
