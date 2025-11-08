import { Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AviatorWs } from '../../entities/aviator-ws.entity';
import { Bookmaker } from '../../entities/bookmaker.entity';
import { decodeMessage } from './decoder';
import { AviatorGateway } from '../../gateways/aviator.gateway';

interface Connection {
  ws: WebSocket | null;
  status: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED';
  lastPing: Date | null;
}

interface RoundData {
  betsCount: number;
  totalBetAmount: number;
  onlinePlayers: number;
  roundId: string | null;
  maxMultiplier: number;
  currentMultiplier: number;
  totalCashout: number;
  cashoutRecords: Set<string>;
  gameState: 'Bet' | 'Run' | 'End';
}

interface BookmakerWithConfig extends Bookmaker {
  url_websocket: string;
  api_message: string;
  auth_message: string;
  ping_message: string;
}

@Injectable()
export class EightStarzWebSocketService {
  private readonly logger = new Logger(EightStarzWebSocketService.name);
  private connections: Map<number, Connection> = new Map();
  private roundData: Map<number, RoundData> = new Map();
  private pingIntervals: Map<number, NodeJS.Timeout> = new Map();
  private maxRetries: number = 10;
  private retryDelay: number = 3000;
  private io: any = null;
  private isResetting: boolean = false;
  private connectingBookmakers: Set<number> = new Set();

  constructor(
    @InjectRepository(AviatorWs)
    private aviatorWsRepository: Repository<AviatorWs>,
    @InjectRepository(Bookmaker)
    private bookmakerRepository: Repository<Bookmaker>,
    private gateway: AviatorGateway,
  ) {}

  async initializeConnections(): Promise<void> {
    this.io = this.gateway.getServer();
    this.logger.log('🎰 Inicializando conexiones WebSocket de 888starz');
    
    try {
      const bookmakers = await this.getBookmakersWithConfigs();
      this.logger.log(`📋 Encontrados ${bookmakers.length} bookmakers de 888starz`);
      
      for (const bookmaker of bookmakers) {
        if (this.isValidBookmaker(bookmaker)) {
          this.logger.log(`✅ Conectando a bookmaker ${bookmaker.id} (${bookmaker.bookmaker})`);
          this.connectToBookmaker(bookmaker, 0);
        } else {
          this.logger.warn(`⚠️ Configuración inválida para bookmaker ${bookmaker.id}, omitiendo conexión`);
        }
      }

      // Verificar actualizaciones de bookmakers cada minuto
      setInterval(async () => {
        if (this.isResetting) return;
        try {
          const updatedBookmakers = await this.getBookmakersWithConfigs();
          updatedBookmakers.forEach((bookmaker) => {
            if (
              this.isValidBookmaker(bookmaker) &&
              !this.connections.has(bookmaker.id)
            ) {
              this.connectToBookmaker(bookmaker, 0);
            } else if (
              (!this.isValidBookmaker(bookmaker) && this.connections.has(bookmaker.id))
            ) {
              const connection = this.connections.get(bookmaker.id);
              if (connection?.ws) {
                connection.ws.close();
                this.logger.log(`Closed WebSocket for bookmaker ${bookmaker.id} due to invalid config`);
              }
              clearInterval(this.pingIntervals.get(bookmaker.id));
              this.connections.delete(bookmaker.id);
              this.pingIntervals.delete(bookmaker.id);
              this.roundData.delete(bookmaker.id);
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

  private isValidBookmaker(bookmaker: BookmakerWithConfig): boolean {
    const { url_websocket, api_message, auth_message, ping_message } = bookmaker;
    const isValidBase64 = (str: string): boolean => Boolean(str && /^[A-Za-z0-9+/=]+$/.test(str) && str.length % 4 === 0);
    return Boolean(
      url_websocket &&
      url_websocket.startsWith('wss://') &&
      api_message &&
      isValidBase64(api_message) &&
      auth_message &&
      isValidBase64(auth_message) &&
      ping_message &&
      isValidBase64(ping_message)
    );
  }

  private async getBookmakersWithConfigs(): Promise<BookmakerWithConfig[]> {
    const aviatorConfigs = await this.aviatorWsRepository.find({
      relations: ['bookmaker'],
      where: { 
        gameId: 1, // Aviator game ID
        bookmakerId: 3, // Solo 888starz (ID 3)
        bookmaker: {
          isActive: true
        }
      }
    });

    return aviatorConfigs.map(config => ({
      ...config.bookmaker,
      url_websocket: config.url_websocket,
      api_message: config.api_message || '',
      auth_message: config.auth_message || '',
      ping_message: config.ping_message || ''
    }));
  }

  private connectToBookmaker(bookmaker: BookmakerWithConfig, retryCount: number): void {
    const { id, bookmaker: name, url_websocket, api_message, auth_message, ping_message } = bookmaker;
    
    if (this.connectingBookmakers.has(id)) {
      this.logger.log(`Ya se está conectando al bookmaker ${id}, saltando conexión duplicada`);
      return;
    }

    const existingConnection = this.connections.get(id);
    if (existingConnection && existingConnection.status === 'CONNECTED' && existingConnection.ws?.readyState === WebSocket.OPEN) {
      this.logger.log(`WebSocket ya está conectado para bookmaker ${id}, saltando conexión`);
      return;
    }

    this.connectingBookmakers.add(id);

    const headers = {
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      Origin: 'https://aviator-next.spribegaming.com',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Accept-Language': 'es-419,es;q=0.9',
      'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
    };

    try {
      if (!this.isValidBookmaker(bookmaker)) {
        throw new Error(`Invalid configuration for bookmaker ${id}`);
      }

      // Limpiar conexión existente
      if (this.connections.has(id)) {
        const connection = this.connections.get(id);
        if (connection?.ws) {
          connection.ws.close(1000, 'Closing for reset');
          this.logger.log(`Closed existing WebSocket for bookmaker ${id}`);
        }
        clearInterval(this.pingIntervals.get(id));
        this.connections.delete(id);
        this.pingIntervals.delete(id);
        this.roundData.delete(id);
      }

      const ws = new WebSocket(url_websocket, [], { headers });

      this.connections.set(id, { ws, status: 'CONNECTING', lastPing: null });
      this.updateWebSocketStatusInDB(id, 'CONNECTING');
      this.roundData.set(id, {
        betsCount: 0,
        totalBetAmount: 0,
        onlinePlayers: 0,
        roundId: null,
        maxMultiplier: 0,
        currentMultiplier: 0,
        totalCashout: 0,
        cashoutRecords: new Set(),
        gameState: 'Bet',
      });

      ws.on('open', () => {
        this.logger.log(`🔗 [888starz] WebSocket connected for bookmaker ${id}`);
        this.connections.set(id, { ws, status: 'CONNECTED', lastPing: new Date() });
        this.connectingBookmakers.delete(id);
        this.updateWebSocketStatusInDB(id, 'CONNECTED');
        ws.send(Buffer.from(api_message, 'base64'));
      });

      ws.on('message', async (data: Buffer) => {
        try {
          this.logger.log(`📥 [888starz] Mensaje RAW recibido para bookmaker ${id} - Tamaño: ${data.length} bytes`);
          
          const decodedMessage = decodeMessage(data);
          if (!decodedMessage) {
            this.logger.warn(`⚠️ [888starz] No se pudo decodificar mensaje para bookmaker ${id}`);
            return;
          }

          this.logger.log(`✅ [888starz] Mensaje decodificado para bookmaker ${id}`);
          this.connections.set(id, { ws, status: 'CONNECTED', lastPing: new Date() });

          if (!(ws as any).firstResponseReceived) {
            this.logger.log(`📤 [888starz] Enviando auth_message para bookmaker ${id}`);
            ws.send(Buffer.from(auth_message, 'base64'));
            (ws as any).firstResponseReceived = true;
          }

          await this.processGameData(id, name, decodedMessage);
        } catch (error) {
          this.logger.error(`❌ [888starz] Error processing message for bookmaker ${id}:`, error);
        }
      });

      ws.on('error', (error: Error) => {
        this.logger.error(`❌ [888starz] WebSocket error for bookmaker ${id}: ${error.message}`);
        
        if (ws.readyState === WebSocket.CLOSED) {
          this.connections.set(id, { ws, status: 'DISCONNECTED', lastPing: this.connections.get(id)?.lastPing || null });
          this.updateWebSocketStatusInDB(id, 'DISCONNECTED');
          
          if (!this.isResetting) {
            this.handleReconnect(bookmaker, retryCount);
          }
        }
      });

      ws.on('close', async (code: number, reason: Buffer) => {
        this.logger.log(`🔌 [888starz] WebSocket closed for bookmaker ${id} (code: ${code})`);
        this.connections.set(id, { ws, status: 'DISCONNECTED', lastPing: this.connections.get(id)?.lastPing || null });
        this.updateWebSocketStatusInDB(id, 'DISCONNECTED');
        this.connectingBookmakers.delete(id);
        
        clearInterval(this.pingIntervals.get(id));
        this.pingIntervals.delete(id);
        
        const roundData = this.roundData.get(id);
        if (roundData?.roundId && roundData.maxMultiplier > 0) {
          await this.saveRoundData(id, name, roundData.maxMultiplier);
        }
        
        if (!this.isResetting) {
          this.handleReconnect(bookmaker, retryCount);
        }
      });

      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(Buffer.from(ping_message, 'base64'));
            this.connections.set(id, { 
              ws, 
              status: 'CONNECTED', 
              lastPing: new Date() 
            });
          } catch (error) {
            this.logger.error(`Error sending PING for bookmaker ${id}:`, error);
            if (!this.isResetting) {
              this.handleReconnect(bookmaker, retryCount);
            }
          }
        } else {
          if (!this.isResetting) {
            this.handleReconnect(bookmaker, retryCount);
          }
        }
      }, 10000);

      this.pingIntervals.set(id, pingInterval);
    } catch (error) {
      this.logger.error(`Failed to connect WebSocket for bookmaker ${id}:`, error);
      this.connections.set(id, { ws: null, status: 'DISCONNECTED', lastPing: null });
      this.updateWebSocketStatusInDB(id, 'DISCONNECTED');
      this.connectingBookmakers.delete(id);
      if (!this.isResetting) {
        this.handleReconnect(bookmaker, retryCount);
      }
    }
  }

  private async processGameData(id: number, name: string, decodedMessage: any): Promise<void> {
    const roundData = this.roundData.get(id);
    if (!roundData) return;

    if (decodedMessage.p) {
      const { p, c } = decodedMessage.p;

      if (c === 'updateCurrentBets') {
        roundData.betsCount = Math.max(roundData.betsCount, p.betsCount || 0);
        roundData.totalBetAmount = p.bets?.reduce((sum: number, bet: any) => sum + (bet.bet || 0), 0) || 0;
        roundData.gameState = 'Bet';
      } else if (c === 'onlinePlayers') {
        roundData.onlinePlayers = p.onlinePlayers || 0;
      } else if (c === 'changeState') {
        if (p.newStateId === 1) {
          roundData.gameState = 'Bet';
          roundData.roundId = p.roundId || roundData.roundId;
          roundData.currentMultiplier = 0;
          if (p.roundId && this.io) {
            this.io.to(`bookmaker:${id}`).emit('roundStart', {
              roundId: p.roundId,
              gameState: 'Bet',
            });
          }
        } else if (p.newStateId === 2) {
          roundData.gameState = 'Run';
          roundData.roundId = p.roundId || roundData.roundId;
          roundData.currentMultiplier = 0;
        }
      } else if (c === 'updateCurrentCashOuts') {
        p.cashouts?.forEach((cashout: any) => {
          const cashoutKey = `${cashout.player_id || ''}-${cashout.betId || ''}-${cashout.multiplier || 0}`;
          if (!roundData.cashoutRecords.has(cashoutKey)) {
            roundData.totalCashout += cashout.winAmount || 0;
            roundData.cashoutRecords.add(cashoutKey);
          }
        });
      } else if (c === 'x') {
        if (p.crashX !== undefined) {
          this.logger.log(`🎯 [888starz] CRASH detectado en bookmaker ${id}: ${p.crashX}x`);
          roundData.maxMultiplier = p.crashX || 0;
          roundData.currentMultiplier = p.crashX || 0;
          roundData.gameState = 'End';
          if (roundData.roundId) {
            await this.saveRoundData(id, name, p.crashX);
            
            // Obtener y emitir las 100 rondas más recientes
            const updatedHistory = await this.fetchRecentRounds(id, 100);
            this.io.to(`bookmaker:${id}`).emit('history', {
              rounds: updatedHistory
            });
            
            setTimeout(() => this.resetRoundData(id), 4000);
          }
        } else {
          roundData.currentMultiplier = p.x || 0;
          roundData.gameState = 'Run';
          if (this.io) {
            this.io.to(`bookmaker:${id}`).emit('multiplier', {
              bookmakerId: id,
              current_multiplier: roundData.currentMultiplier.toFixed(2),
            });
          }
        }
      } else if (c === 'roundChartInfo') {
        if (p.roundId) {
          roundData.roundId = p.roundId;
          roundData.maxMultiplier = p.maxMultiplier || 0;
          roundData.currentMultiplier = p.maxMultiplier || 0;
          if (this.io) {
            this.io.to(`bookmaker:${id}`).emit('roundChartInfo', {
              maxMultiplier: p.maxMultiplier,
              roundId: p.roundId,
            });
          }
        }
      }

      const casinoProfit = roundData.totalBetAmount - roundData.totalCashout;
      if (this.io) {
        this.io.to(`bookmaker:${id}`).emit('round', {
          online_players: roundData.onlinePlayers,
          bets_count: roundData.betsCount,
          total_bet_amount: roundData.totalBetAmount,
          total_cashout: roundData.totalCashout,
          current_multiplier: roundData.currentMultiplier,
          max_multiplier: roundData.maxMultiplier,
          game_state: roundData.gameState,
          casino_profit: Number(casinoProfit.toFixed(2)),
          round_id: roundData.roundId,
        });
      }
    }
  }

  private handleReconnect(bookmaker: BookmakerWithConfig, retryCount: number): void {
    const existingConnection = this.connections.get(bookmaker.id);
    if (existingConnection && existingConnection.status === 'CONNECTED' && existingConnection.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.updateWebSocketStatusInDB(bookmaker.id, 'CONNECTING');

    if (retryCount >= this.maxRetries) {
      this.logger.error(`ACTUALIZA TU TOKEN para bookmaker ${bookmaker.id}. Máximo de intentos (${this.maxRetries}) alcanzado.`);
      setTimeout(() => {
        this.connectToBookmaker(bookmaker, 0);
      }, 300000); // 5 minutos
      return;
    }

    const delay = Math.min(this.retryDelay * Math.pow(2, retryCount), 60000) + Math.random() * 1000;
    this.logger.log(`Attempting to reconnect for bookmaker ${bookmaker.id} (Attempt ${retryCount + 1}/${this.maxRetries}) in ${Math.round(delay)}ms`);
    
    setTimeout(() => {
      this.connectToBookmaker(bookmaker, retryCount + 1);
    }, delay);
  }

  private async updateWebSocketStatusInDB(bookmakerId: number, status: string): Promise<void> {
    try {
      const aviatorWs = await this.aviatorWsRepository.findOne({ where: { bookmakerId } });
      if (aviatorWs) {
        aviatorWs.status_ws = status;
        await this.aviatorWsRepository.save(aviatorWs);
      }
    } catch (error) {
      this.logger.error(`Error actualizando estado WebSocket en BD para bookmaker ${bookmakerId}:`, error);
    }
  }

  private async saveRoundData(bookmaker_id: number, bookmaker_name: string, crashX: number): Promise<void> {
    const roundData = this.roundData.get(bookmaker_id);
    if (!roundData) return;

    try {
      this.logger.log(`💾 [888starz] Guardando ronda para ${bookmaker_name}: Crash at ${crashX}x`);
      
      const casinoProfit = roundData.totalBetAmount - roundData.totalCashout;
      const lossPercentage = roundData.totalBetAmount > 0 ? 
        ((casinoProfit / roundData.totalBetAmount) * 100) : 0;

      await this.aviatorWsRepository.query(`
        INSERT INTO aviator_rounds (
          bookmaker_id, 
          round_id, 
          bets_count, 
          total_bet_amount, 
          online_players, 
          max_multiplier, 
          total_cashout, 
          casino_profit, 
          loss_percentage, 
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `, [
        bookmaker_id,
        roundData.roundId,
        roundData.betsCount,
        roundData.totalBetAmount,
        roundData.onlinePlayers,
        crashX,
        roundData.totalCashout,
        casinoProfit,
        lossPercentage,
        new Date()
      ]);

      this.logger.log(`✅ [888starz] Ronda guardada exitosamente - Round ${roundData.roundId}`);
    } catch (error) {
      this.logger.error(`Error saving round data for bookmaker ${bookmaker_id}:`, error);
    }
  }

  private resetRoundData(bookmaker_id: number): void {
    const currentRoundData = this.roundData.get(bookmaker_id);
    this.roundData.set(bookmaker_id, {
      betsCount: 0,
      totalBetAmount: 0,
      onlinePlayers: currentRoundData?.onlinePlayers || 0,
      roundId: null,
      maxMultiplier: 0,
      currentMultiplier: 0,
      totalCashout: 0,
      cashoutRecords: new Set(),
      gameState: 'Bet',
    });
  }

  private async fetchRecentRounds(bookmakerId: number, limit: number = 100): Promise<any[]> {
    // Usar subconsulta para obtener las últimas N rondas y ordenarlas por fecha ASC
    const rows = await this.aviatorWsRepository.query(
      `SELECT round_id, max_multiplier, total_bet_amount, total_cashout, casino_profit, bets_count, online_players, created_at
       FROM (
         SELECT round_id, max_multiplier, total_bet_amount, total_cashout, casino_profit, bets_count, online_players, created_at
         FROM aviator_rounds
         WHERE bookmaker_id = $1
         ORDER BY created_at DESC
         LIMIT $2
       ) AS recent_rounds
       ORDER BY created_at ASC`,
      [bookmakerId, limit]
    );

    // Ya viene ordenado ASC (más antigua primero, más reciente al final)
    return rows.map((r: any) => ({
      round_id: r.round_id,
      max_multiplier: Number(r.max_multiplier),
      total_bet_amount: Number(r.total_bet_amount),
      total_cashout: Number(r.total_cashout),
      casino_profit: Number(r.casino_profit),
      bets_count: Number(r.bets_count),
      online_players: Number(r.online_players),
      created_at: r.created_at
    }));
  }

  async resetAllConnections(): Promise<void> {
    try {
      this.isResetting = true;
      this.logger.log('Resetting all 888starz WebSocket connections...');

      for (const [bookmakerId, connection] of this.connections) {
        if (connection.ws) {
          connection.ws.close(1000, 'Reset requested');
        }
        clearInterval(this.pingIntervals.get(bookmakerId));
        this.pingIntervals.delete(bookmakerId);
      }

      this.connections.clear();
      this.roundData.clear();
      this.connectingBookmakers.clear();

      setTimeout(() => {
        this.isResetting = false;
      }, 5000);
      
    } catch (error) {
      this.logger.error('Error resetting connections:', error);
      this.isResetting = false;
    }
  }

  getConnectionsStatus(): any[] {
    return Array.from(this.connections.entries()).map(([bookmakerId, connection]) => ({
      bookmakerId,
      status: connection.status,
      lastPing: connection.lastPing,
      roundData: this.roundData.get(bookmakerId),
    }));
  }
}
