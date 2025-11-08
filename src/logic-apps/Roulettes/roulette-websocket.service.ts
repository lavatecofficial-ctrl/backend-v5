import { Injectable } from '@nestjs/common';
import { WebSocket } from 'ws';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RouletteRound, RouletteColor, RouletteDozen, RouletteColumn } from '../../entities/roulette-round.entity';
import { RouletteWs } from '../../entities/roulette-ws.entity';
import { Bookmaker } from '../../entities/bookmaker.entity';

import { RouletteGateway } from '../../gateways/roulette.gateway';
import { PredictorService } from '../../services/predictor/predictor.service';
import { RouletteLoggerWrapper } from '../../config/winston.config';

interface Connection {
  ws: WebSocket | null;
  status: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED';
  lastPing: Date | null;
}

interface BookmakerWithConfig extends Bookmaker {
  pageName?: string;
}

@Injectable()
export class RouletteWebSocketService {
  private readonly logger = new RouletteLoggerWrapper();
  private connections: Map<number, Connection> = new Map();
  private latestRounds: Map<number, { roundId: string; timestamp: string }> = new Map();
  private pingIntervals: Map<number, NodeJS.Timeout> = new Map();
  private maxRetries: number = 3;
  private io: any = null;
  private isResetting: boolean = false;
  private predictionInFlight: Set<number> = new Set();

  constructor(
    @InjectRepository(RouletteRound)
    private rouletteRoundRepository: Repository<RouletteRound>,
    @InjectRepository(RouletteWs)
    private rouletteWsRepository: Repository<RouletteWs>,
    @InjectRepository(Bookmaker)
    private bookmakerRepository: Repository<Bookmaker>,
    private gateway: RouletteGateway,
    private predictorService: PredictorService,
  ) {}

  async initializeConnections(io: any): Promise<void> {
    this.io = this.gateway.getServer();
    this.logger.log('Inicializando conexiones WebSocket de Ruleta');
    
    try {
      const bookmakers = await this.getRouletteBookmakers();
      for (const bookmaker of bookmakers) {
        this.connectToRoulette(bookmaker, this.io, 0);
      }

      // Verificar actualizaciones de bookmakers cada minuto
      setInterval(async () => {
        if (this.isResetting) return;
        try {
          const updatedBookmakers = await this.getRouletteBookmakers();
          updatedBookmakers.forEach((bookmaker) => {
            if (!this.connections.has(bookmaker.id)) {
              this.connectToRoulette(bookmaker, io, 0);
            }
          });
        } catch (error) {
          this.logger.error('Error checking bookmakers for WebSocket updates:', error);
        }
      }, 60000);
    } catch (error) {
      this.logger.error('Error initializing WebSocket connections:', error);
    }
  }

  private async getRouletteBookmakers(): Promise<BookmakerWithConfig[]> {
    // Obtener configuraciones de WebSocket para ruletas
    const rouletteConfigs = await this.rouletteWsRepository.find({
      where: { 
        gameId: 3, // ID para ruletas
      },
      relations: ['bookmaker']
    });

    return rouletteConfigs.map(config => ({
      ...config.bookmaker,
      pageName: config.page
    }));
  }



  private mapColor(number: number): RouletteColor {
    if (number === 0) return RouletteColor.GREEN;
    const redNumbers = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
    return redNumbers.includes(number) ? RouletteColor.RED : RouletteColor.BLACK;
  }

  private mapDozen(number: number): RouletteDozen {
    if (number === 0) return RouletteDozen.ZERO;
    if (number >= 1 && number <= 12) return RouletteDozen.FIRST;
    if (number >= 13 && number <= 24) return RouletteDozen.SECOND;
    return RouletteDozen.THIRD;
  }

  private mapColumn(number: number): RouletteColumn {
    if (number === 0) return RouletteColumn.ZERO;
    if (number % 3 === 1) return RouletteColumn.FIRST;
    if (number % 3 === 2) return RouletteColumn.SECOND;
    return RouletteColumn.THIRD;
  }

  private connectToRoulette(bookmaker: BookmakerWithConfig, io: any, retryCount: number): void {
    const { id, pageName } = bookmaker;
    const wsUrl = process.env.ROULETTE_WS_URL || 'wss://squid-app-67gkf.ondigitalocean.app/ws?hash=7abcb91fc92b6d855a84c4da59549cf5f1f895234e468c2f68fd0a45deb9eefd';
    
    const headers = {
      Host: 'squid-app-67gkf.ondigitalocean.app',
      Connection: 'Upgrade',
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
      Upgrade: 'websocket',
      Origin: 'https://gamblingcounting.com',
      'Sec-WebSocket-Version': '13',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Accept-Language': 'es-419,es;q=0.9',
      'Sec-WebSocket-Key': Buffer.from(Math.random().toString(36).substring(2) + Date.now().toString(36)).toString('base64').substring(0, 24),
      'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
    };

    try {
      // Limpiar conexión existente
      if (this.connections.has(id)) {
        const connection = this.connections.get(id);
        if (connection?.ws) {
          connection.ws.close(1000, 'Closing for reset');
          this.logger.log(`Closed existing WebSocket for roulette ${id}`);
        }
        clearInterval(this.pingIntervals.get(id));
        this.connections.delete(id);
        this.pingIntervals.delete(id);
        this.latestRounds.delete(id);
      }

      const ws = new WebSocket(wsUrl, { headers });
      let handshakeSent = false;

      this.connections.set(id, { ws, status: 'CONNECTING', lastPing: null });

      ws.on('open', () => {
        this.logger.log(`WebSocket connected for roulette ${id} (${pageName})`);
        this.connections.set(id, { ws, status: 'CONNECTED', lastPing: new Date() });
      });

      ws.on('message', async (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          
          if (!handshakeSent && message.type === 'ping' && message.data === '7abcb91fc92b6d855a84c4da59549cf5f1f895234e468c2f68fd0a45deb9eefd') {
            ws.send(JSON.stringify({ type: 'common', event: 'handshake', data: '55aFCRoAlzd2jkjk4vCEHHhwGXgwSVKM9FgO7NwA3diIRLVnmqpJ' }));
            ws.send(JSON.stringify({ type: 'common', event: 'userKey', data: 'lyonLXa36hP8WQ3' }));
            ws.send(JSON.stringify({ type: 'user', event: 'startTgAuth', data: '' }));
            ws.send(JSON.stringify({ type: 'common', event: 'changePage', data: { from: 'MainPage', to: pageName } }));
            handshakeSent = true;
            this.logger.log(`Handshake sent for roulette ${id} (${pageName})`);
          }

          if (message.type === 'liveGame' && message.event === 'liveGameFullData') {
            const rouletteKey = Object.keys(message.data)[0];
            const rouletteData = message.data[rouletteKey];
            
            if (!rouletteData?.df?.result || !Array.isArray(rouletteData.df.result)) {
              return;
            }

            const [number, roundId] = rouletteData.df.result[0] || [];
            if (number === undefined || roundId === undefined) {
              return;
            }

            const timestamp = new Date(rouletteData.t * 1000);
            const color = this.mapColor(number);
            const dozen = this.mapDozen(number);
            const column = this.mapColumn(number);

            // Verificar si ya procesamos esta ronda
            const latest = this.latestRounds.get(id);
            if (latest && latest.roundId === roundId) {
              return;
            }

            this.latestRounds.set(id, { roundId, timestamp: timestamp.toISOString() });

            // Verificar si la ronda ya existe en la base de datos
            const existing = await this.rouletteRoundRepository.findOne({
              where: { roundId, bookmakerId: id }
            });

            if (existing) {
              return;
            }

                         // Guardar la nueva ronda
             const newRound = this.rouletteRoundRepository.create({
               bookmakerId: id,
               roundId,
               number,
               color,
               dozen,
               column,
               timestamp: timestamp,
               createdAt: timestamp
             });

            await this.rouletteRoundRepository.save(newRound);

            const roundData = {
              bookmakerId: id,
              rouletteName: pageName,
              roundId,
              number,
              color,
              dozen,
              column,
              timestamp: timestamp.toISOString()
            };

            // Emitir a los clientes
            if (this.io) {
              this.io.to(`roulette:${id}`).emit('newRound', roundData);
              this.logger.log(`📡 Nueva ronda de ruleta emitida para bookmaker ${id}: ${number} (${color})`);
            }

            // Lanzar predicción para la próxima ronda (dedupe por bookmaker)
            this.triggerPrediction(id).catch((err) => {
              this.logger.error(`Error triggering prediction for roulette ${id}: ${err?.message || err}`);
            });
          }
        } catch (error) {
          this.logger.error(`Error processing message for roulette ${id}:`, error);
        }
      });

      ws.on('error', (error: Error) => {
        this.logger.error(`WebSocket error for roulette ${id}: ${error.message}`);
        this.connections.set(id, { ws, status: 'DISCONNECTED', lastPing: this.connections.get(id)?.lastPing || null });
        if (!this.isResetting) {
          this.handleReconnect(bookmaker, io, retryCount);
        }
      });

      ws.on('close', (code: number, reason: Buffer) => {
        this.logger.log(`WebSocket closed for roulette ${id} (code: ${code}, reason: ${reason || 'No reason provided'})`);
        this.connections.set(id, { ws, status: 'DISCONNECTED', lastPing: this.connections.get(id)?.lastPing || null });
        if (!this.isResetting) {
          this.handleReconnect(bookmaker, io, retryCount);
        }
      });

      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: 'ping' }));
          } catch (error) {
            this.logger.error(`Error sending PING for roulette ${id}:`, error);
            if (!this.isResetting) {
              this.handleReconnect(bookmaker, io, retryCount);
            }
          }
        }
      }, 60000);

      this.pingIntervals.set(id, pingInterval);

      ws.on('close', () => {
        clearInterval(this.pingIntervals.get(id));
        this.pingIntervals.delete(id);
      });
    } catch (error) {
      this.logger.error(`Failed to connect WebSocket for roulette ${id}:`, error);
      this.connections.set(id, { ws: null, status: 'DISCONNECTED', lastPing: null });
      if (!this.isResetting) {
        this.handleReconnect(bookmaker, io, retryCount);
      }
    }
  }

  private handleReconnect(bookmaker: BookmakerWithConfig, io: any, retryCount: number): void {
    if (retryCount >= this.maxRetries) {
      this.logger.error(`ACTUALIZA TU TOKEN para ruleta ${bookmaker.id}. Máximo de intentos (${this.maxRetries}) alcanzado.`);
      return;
    }

    this.logger.log(`Attempting to reconnect for roulette ${bookmaker.id} (Attempt ${retryCount + 1}/${this.maxRetries})`);
    const delay = Math.min(1000 * Math.pow(2, retryCount), 60000);
    setTimeout(() => {
      this.connectToRoulette(bookmaker, io, retryCount + 1);
    }, delay + Math.random() * 100);
  }

  async resetAllConnections(): Promise<void> {
    try {
      this.isResetting = true;
      this.logger.log('Resetting all WebSocket connections for roulettes...');

      for (const [bookmakerId, connection] of this.connections) {
        if (connection.ws) {
          connection.ws.close(1000, 'Reset requested');
        }
        clearInterval(this.pingIntervals.get(bookmakerId));
        this.pingIntervals.delete(bookmakerId);
      }

      this.connections.clear();
      this.latestRounds.clear();

      this.logger.log('All roulette connections reset successfully');
    } catch (error) {
      this.logger.error('Error resetting roulette connections:', error);
    } finally {
      this.isResetting = false;
    }
  }

  async stopAllConnections(): Promise<void> {
    try {
      this.isResetting = true;
      this.logger.log('Stopping all WebSocket connections for roulettes...');

      // Cerrar todas las conexiones WebSocket
      for (const [bookmakerId, connection] of this.connections) {
        if (connection.ws) {
          connection.ws.close(1000, 'Service stopped');
        }
        clearInterval(this.pingIntervals.get(bookmakerId));
        this.pingIntervals.delete(bookmakerId);
      }

      // Limpiar todos los mapas
      this.connections.clear();
      this.latestRounds.clear();

      this.logger.log('All roulette connections stopped successfully');
    } catch (error) {
      this.logger.error('Error stopping roulette connections:', error);
      throw error;
    } finally {
      this.isResetting = false;
    }
  }

  getConnectionsStatus(): any[] {
    return Array.from(this.connections.entries()).map(([bookmakerId, connection]) => ({
      bookmakerId,
      status: connection.status,
      lastPing: connection.lastPing,
      latestRound: this.latestRounds.get(bookmakerId)
    }));
  }

  // --- Auxiliares internos ---
  private async triggerPrediction(bookmakerId: number): Promise<void> {
    if (this.predictionInFlight.has(bookmakerId)) return;
    this.predictionInFlight.add(bookmakerId);
    try {
      const rounds = await this.fetchRecentRounds(bookmakerId, 30);
      if (!rounds.length) return;
      const response = await this.predictorService.predictRoulette(rounds as any, bookmakerId);
      if (this.io) {
        this.io.to(`roulette:${bookmakerId}`).emit('prediction', {
          bookmakerId,
          ...response,
        });
      }
    } catch (err: any) {
      this.logger.error(`Roulette prediction failed for bookmaker ${bookmakerId}: ${err?.message || err}`);
    } finally {
      this.predictionInFlight.delete(bookmakerId);
    }
  }

  private async fetchRecentRounds(
    bookmakerId: number,
    limit: number = 30,
  ): Promise<Array<{
    round_id: string;
    number: number;
    color: string;
    dozen: string;
    column: string;
    timestamp: string;
  }>> {
    const rows = await this.rouletteRoundRepository.find({
      where: { bookmakerId },
      order: { createdAt: 'DESC' as any },
      take: limit,
    });

    return rows
      .map((r) => ({
        round_id: r.roundId,
        number: r.number,
        color: r.color as any,
        dozen: r.dozen as any,
        column: r.column as any,
        timestamp: (r.timestamp || r.createdAt).toISOString(),
      }))
      .reverse();
  }
}
