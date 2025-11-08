import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, UseGuards } from '@nestjs/common';
import { SpacemanWebSocketService } from './spaceman-websocket.service';
import { SpacemanService } from './spaceman.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/spaceman',
})
export class SpacemanGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private logger: Logger = new Logger('SpacemanGateway');

  constructor(
    private readonly spacemanWebSocketService: SpacemanWebSocketService,
    private readonly spacemanService: SpacemanService,
  ) {}

  afterInit(server: Server) {
    this.logger.log('Spaceman WebSocket Gateway inicializado');
    
    // Solo configurar el servidor Socket.IO, NO inicializar conexiones automáticamente
    this.spacemanWebSocketService.setSocketIO(server);
    
    this.logger.log('Spaceman listo para activación manual via endpoint /spaceman/start');
  }

  async handleConnection(client: Socket) {
    try {
      this.logger.log(`Cliente conectado: ${client.id}`);
      
      // Enviar lista de spacemen disponibles
      const spacemen = await this.spacemanService.findAll();
      client.emit('spacemen_list', {
        success: true,
        data: spacemen,
      });
      
      // Enviar estado de conexiones
      const connectionsStatus = this.spacemanWebSocketService.getAllConnectionsStatus();
      client.emit('connections_status', {
        success: true,
        data: connectionsStatus,
      });
    } catch (error) {
      this.logger.error(`Error en conexión: ${error.message}`);
      client.emit('error', {
        success: false,
        message: 'Error al conectar con el servidor',
      });
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Cliente desconectado: ${client.id}`);
  }

  @SubscribeMessage('join_spaceman')
  async handleJoinSpaceman(
    @MessageBody() data: { spacemanId: number },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const { spacemanId } = data;
      
      if (!spacemanId || typeof spacemanId !== 'number') {
        client.emit('error', {
          success: false,
          message: 'ID de Spaceman inválido',
        });
        return;
      }

      // Buscar Spaceman por bookmakerId en lugar de por ID directo
      const spaceman = await this.spacemanService.findByBookmakerId(spacemanId);
      
      if (!spaceman) {
        this.logger.warn(`Spaceman no encontrado para bookmakerId: ${spacemanId}`);
        client.emit('error', {
          success: false,
          message: `Spaceman no encontrado para bookmaker ID: ${spacemanId}. Es posible que necesites crear un registro en la tabla spaceman_ws.`,
        });
        return;
      }

      // Unirse a la sala del Spaceman
      const roomName = `spaceman:${spaceman.id}`;
      await client.join(roomName);
      
      this.logger.log(`Cliente ${client.id} se unió a la sala ${roomName} (Spaceman ID: ${spaceman.id}, Bookmaker ID: ${spaceman.bookmakerId})`);
      
      // Enviar datos iniciales
      const latestRounds = await this.spacemanService.getLatestRounds(spaceman.id, 100);
      const stats = await this.spacemanService.getStats(spaceman.id);
      const connectionStatus = {
        multiplier: {
          status: this.spacemanWebSocketService.getConnectionStatus(spaceman.id, 'multiplier'),
          retryCount: this.spacemanWebSocketService.getRetryCount(spaceman.id, 'multiplier'),
        },
        finance: {
          status: this.spacemanWebSocketService.getConnectionStatus(spaceman.id, 'finance'),
          retryCount: this.spacemanWebSocketService.getRetryCount(spaceman.id, 'finance'),
        },
      };

      client.emit('spaceman_joined', {
        success: true,
        message: `Conectado a Spaceman ID: ${spaceman.id} (Bookmaker: ${spaceman.bookmakerId})`,
        data: {
          spaceman,
          latestRounds,
          stats,
          connectionStatus,
        },
      });
    } catch (error) {
      this.logger.error(`Error al unirse a Spaceman: ${error.message}`);
      client.emit('error', {
        success: false,
        message: 'Error al unirse al Spaceman',
      });
    }
  }

  @SubscribeMessage('leave_spaceman')
  async handleLeaveSpaceman(
    @MessageBody() data: { spacemanId: number },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const { spacemanId } = data;
      
      if (!spacemanId || typeof spacemanId !== 'number') {
        client.emit('error', {
          success: false,
          message: 'ID de Spaceman inválido',
        });
        return;
      }

      const roomName = `spaceman:${spacemanId}`;
      await client.leave(roomName);
      
      this.logger.log(`Cliente ${client.id} salió de la sala ${roomName}`);
      
      client.emit('spaceman_left', {
        success: true,
        message: 'Desconectado del Spaceman',
        data: { spacemanId },
      });
    } catch (error) {
      this.logger.error(`Error al salir de Spaceman: ${error.message}`);
      client.emit('error', {
        success: false,
        message: 'Error al salir del Spaceman',
      });
    }
  }

  @SubscribeMessage('get_spaceman_stats')
  async handleGetSpacemanStats(
    @MessageBody() data: { spacemanId: number },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const { spacemanId } = data;
      
      if (!spacemanId || typeof spacemanId !== 'number') {
        client.emit('error', {
          success: false,
          message: 'ID de Spaceman inválido',
        });
        return;
      }

      const stats = await this.spacemanService.getStats(spacemanId);
      
      client.emit('spaceman_stats', {
        success: true,
        data: stats,
      });
    } catch (error) {
      this.logger.error(`Error al obtener estadísticas: ${error.message}`);
      client.emit('error', {
        success: false,
        message: 'Error al obtener estadísticas',
      });
    }
  }

  @SubscribeMessage('get_latest_rounds')
  async handleGetLatestRounds(
    @MessageBody() data: { spacemanId: number; limit?: number },
    @ConnectedSocket() client: Socket,
  ) {
    try {
      const { spacemanId, limit = 20 } = data;
      
      if (!spacemanId || typeof spacemanId !== 'number') {
        client.emit('error', {
          success: false,
          message: 'ID de Spaceman inválido',
        });
        return;
      }

      const rounds = await this.spacemanService.getLatestRounds(spacemanId, limit);
      
      client.emit('latest_rounds', {
        success: true,
        data: rounds,
      });
    } catch (error) {
      this.logger.error(`Error al obtener últimas rondas: ${error.message}`);
      client.emit('error', {
        success: false,
        message: 'Error al obtener últimas rondas',
      });
    }
  }

  @SubscribeMessage('reset_connections')
  async handleResetConnections(@ConnectedSocket() client: Socket) {
    try {
      this.logger.log(`Reiniciando conexiones WebSocket solicitado por ${client.id}`);
      
      await this.spacemanWebSocketService.resetConnections(this.server);
      
      // Notificar a todos los clientes
      this.server.emit('connections_reset', {
        success: true,
        message: 'Conexiones WebSocket reiniciadas exitosamente',
      });
      
      // Enviar nuevo estado de conexiones
      const connectionsStatus = this.spacemanWebSocketService.getAllConnectionsStatus();
      this.server.emit('connections_status', {
        success: true,
        data: connectionsStatus,
      });
    } catch (error) {
      this.logger.error(`Error al reiniciar conexiones: ${error.message}`);
      client.emit('error', {
        success: false,
        message: 'Error al reiniciar conexiones',
      });
    }
  }
}
