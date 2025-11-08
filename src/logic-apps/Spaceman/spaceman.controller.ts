import { 
  Controller, 
  Get, 
  Post,
  Patch,
  Body,
  Param
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
  @Post('create-default')
  async createDefaultSpaceman() {
    try {
      // Verificar si ya existe un registro para el bookmaker ID 1
      const existingSpaceman = await this.spacemanService.findByBookmakerId(1);
      
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
        bookmakerId: 1, // ID del bookmaker activo (888Starz)
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
