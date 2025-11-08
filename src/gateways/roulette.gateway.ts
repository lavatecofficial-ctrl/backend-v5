import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { RouletteLoggerWrapper } from '../config/winston.config';
import { UseGuards } from '@nestjs/common';
import { WsAuthGuard } from '../auth/guards/ws-auth.guard';
import { RouletteHistoryService } from '../logic-apps/Roulettes/roulette-history.service';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/roulette',
})
@UseGuards(WsAuthGuard)
export class RouletteGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new RouletteLoggerWrapper();
  private connectedClients: Map<string, { socket: Socket; bookmakerId?: number }> = new Map();

  constructor(private rouletteHistoryService: RouletteHistoryService) {}

  afterInit(server: Server) {
    this.logger.log('Gateway Roulette inicializado');
  }

  handleConnection(client: Socket) {
    this.logger.log(`Cliente conectado: ${client.id}`);
    this.connectedClients.set(client.id, { socket: client });
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Cliente desconectado: ${client.id}`);
    
    // Obtener información del cliente antes de eliminarlo
    const clientData = this.connectedClients.get(client.id);
    
    // Limpiar salas si el cliente estaba en alguna
    if (clientData?.bookmakerId) {
      this.logger.log(`Cliente ${client.id} saliendo de todas las salas de roulette:${clientData.bookmakerId}`);
      client.leave(`roulette:${clientData.bookmakerId}`);
    }
    
    // Eliminar de todas las salas por seguridad
    // Socket.IO no expone leaveAll() públicamente, así que manejamos las salas conocidas
    if (clientData?.bookmakerId) {
      client.leave(`roulette:${clientData.bookmakerId}`);
    }
    
    // Eliminar del Map de clientes conectados
    this.connectedClients.delete(client.id);
    
    this.logger.log(`Limpieza completada para cliente ${client.id}`);
  }

  @SubscribeMessage('joinBookmaker')
  async handleJoinBookmaker(client: Socket, bookmakerId: number) {
    this.logger.log(`Cliente ${client.id} unido a ruleta bookmaker:${bookmakerId}`);
    
    // Actualizar el bookmakerId del cliente
    const clientData = this.connectedClients.get(client.id);
    if (clientData) {
      clientData.bookmakerId = bookmakerId;
    }

    // Unir al cliente a la sala del bookmaker
    client.join(`roulette:${bookmakerId}`);
    
    // Obtener y enviar el historial de las 40 rondas más recientes
    try {
      const history = await this.rouletteHistoryService.getRecentRounds(bookmakerId, 40);
      this.logger.log(`Historial obtenido para bookmaker ${bookmakerId}: ${history.length} rondas`);
      client.emit('history', { bookmakerId, rounds: history });
      this.logger.log(`Historial de ruleta enviado al cliente ${client.id}: ${history.length} rondas`);
    } catch (error) {
      this.logger.error(`Error enviando historial de ruleta al cliente ${client.id}:`, error);
    }
    
    // Enviar confirmación
    client.emit('joinedBookmaker', { bookmakerId, success: true });
    
    this.logger.log(`Cliente ${client.id} unido exitosamente a la sala roulette:${bookmakerId}`);
  }

  @SubscribeMessage('leaveBookmaker')
  handleLeaveBookmaker(client: Socket, bookmakerId: number) {
    this.logger.log(`Cliente ${client.id} salió de roulette:${bookmakerId}`);
    client.leave(`roulette:${bookmakerId}`);
    
    // Limpiar el bookmakerId del cliente
    const clientData = this.connectedClients.get(client.id);
    if (clientData) {
      clientData.bookmakerId = undefined;
    }
  }

  // Método para obtener el servidor Socket.IO
  getServer(): Server {
    return this.server;
  }

  // Método para obtener clientes conectados
  getConnectedClients() {
    return this.connectedClients;
  }

  // Método para limpiar conexiones huérfanas
  cleanupOrphanedConnections() {
    const beforeCount = this.connectedClients.size;
    
    for (const [clientId, clientData] of this.connectedClients.entries()) {
      if (!clientData.socket.connected) {
        this.logger.log(`Limpiando conexión huérfana de ruleta: ${clientId}`);
        this.connectedClients.delete(clientId);
      }
    }
    
    const afterCount = this.connectedClients.size;
    const cleanedCount = beforeCount - afterCount;
    
    if (cleanedCount > 0) {
      this.logger.log(`Limpieza de ruleta completada: ${cleanedCount} conexiones huérfanas eliminadas`);
    }
    
    return { beforeCount, afterCount, cleanedCount };
  }

  // Método para obtener estadísticas de conexiones
  getConnectionStats() {
    const totalClients = this.connectedClients.size;
    const connectedClients = Array.from(this.connectedClients.values()).filter(c => c.socket.connected).length;
    const disconnectedClients = totalClients - connectedClients;
    
    return {
      totalClients,
      connectedClients,
      disconnectedClients,
      timestamp: new Date().toISOString()
    };
  }
}
