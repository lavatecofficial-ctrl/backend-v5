import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AviatorLoggerWrapper } from '../config/winston.config';
import { UseGuards } from '@nestjs/common';
import { WsAuthGuard } from '../auth/guards/ws-auth.guard';
import { AviatorHistoryService } from '../logic-apps/Aviator/aviator-history.service';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/aviator',
})
@UseGuards(WsAuthGuard)
export class AviatorGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new AviatorLoggerWrapper();
  private connectedClients: Map<string, { socket: Socket; bookmakerId?: number }> = new Map();

  constructor(private aviatorHistoryService: AviatorHistoryService) {}

  afterInit(server: Server) {
    this.logger.log('Gateway Aviator inicializado');
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
      this.logger.log(`Cliente ${client.id} saliendo de todas las salas de bookmaker:${clientData.bookmakerId}`);
      client.leave(`bookmaker:${clientData.bookmakerId}`);
    }
    
    // Eliminar de todas las salas por seguridad
    // Socket.IO no expone leaveAll() públicamente, así que manejamos las salas conocidas
    if (clientData?.bookmakerId) {
      client.leave(`bookmaker:${clientData.bookmakerId}`);
    }
    
    // Eliminar del Map de clientes conectados
    this.connectedClients.delete(client.id);
    
    this.logger.log(`Limpieza completada para cliente ${client.id}`);
  }

  @SubscribeMessage('joinBookmaker')
  async handleJoinBookmaker(client: Socket, bookmakerId: number) {
    this.logger.log(`Cliente ${client.id} unido a bookmaker:${bookmakerId}`);
    
    // Actualizar el bookmakerId del cliente
    const clientData = this.connectedClients.get(client.id);
    if (clientData) {
      clientData.bookmakerId = bookmakerId;
    }

    // Unir al cliente a la sala del bookmaker
    client.join(`bookmaker:${bookmakerId}`);
    
    // Obtener y enviar el historial de las 100 rondas más recientes
    try {
      const history = await this.aviatorHistoryService.getRecentRounds(bookmakerId, 100);
      
      if (history.length === 0) {
        this.logger.warn(`⚠️ No hay historial en BD para bookmaker ${bookmakerId}`);
      } else {
        this.logger.log(`📤 Historial enviado al cliente ${client.id}: ${history.length} rondas`);
      }
      
      client.emit('history', { bookmakerId, rounds: history });
    } catch (error) {
      this.logger.error(`❌ Error enviando historial al cliente ${client.id}:`, error);
    }
    
    // Enviar confirmación
    client.emit('joinedBookmaker', { bookmakerId, success: true });
    
    this.logger.log(`Cliente ${client.id} unido exitosamente a la sala bookmaker:${bookmakerId}`);
  }

  @SubscribeMessage('leaveBookmaker')
  handleLeaveBookmaker(client: Socket, bookmakerId: number) {
    this.logger.log(`Cliente ${client.id} salió de bookmaker:${bookmakerId}`);
    client.leave(`bookmaker:${bookmakerId}`);
    
    // Limpiar el bookmakerId del cliente
    const clientData = this.connectedClients.get(client.id);
    if (clientData) {
      clientData.bookmakerId = undefined;
    }
  }

  // Métodos para emitir datos a los clientes
  emitMultiplier(bookmakerId: number, data: { current_multiplier: number }) {
    this.server.to(`bookmaker:${bookmakerId}`).emit('multiplier', {
      bookmakerId,
      current_multiplier: data.current_multiplier.toFixed(2),
    });
  }

  emitRoundData(bookmakerId: number, data: {
    online_players: number;
    bets_count: number;
    total_bet_amount: number;
    total_cashout: number;
    current_multiplier: number;
    max_multiplier: number;
    game_state: 'Bet' | 'Run' | 'End';
    round_id?: string;
    casino_profit?: number;
  }) {
    this.server.to(`bookmaker:${bookmakerId}`).emit('round', {
      ...data,
      casino_profit: data.casino_profit || (data.total_bet_amount - data.total_cashout),
    });
  }

  emitRoundStart(bookmakerId: number, data: { roundId: string }) {
    this.server.to(`bookmaker:${bookmakerId}`).emit('roundStart', data);
  }

  emitRoundChartInfo(bookmakerId: number, data: { maxMultiplier: number; roundId: string }) {
    this.server.to(`bookmaker:${bookmakerId}`).emit('roundChartInfo', data);
  }

  emitPrediction(bookmakerId: number, data: {
    prediction: number;
    score: number;
    apostar: 'SI' | 'NO';
    round_id: string;
  }) {
    this.server.to(`bookmaker:${bookmakerId}`).emit('prediction', data);
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
        this.logger.log(`Limpiando conexión huérfana: ${clientId}`);
        this.connectedClients.delete(clientId);
      }
    }
    
    const afterCount = this.connectedClients.size;
    const cleanedCount = beforeCount - afterCount;
    
    if (cleanedCount > 0) {
      this.logger.log(`Limpieza completada: ${cleanedCount} conexiones huérfanas eliminadas`);
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
