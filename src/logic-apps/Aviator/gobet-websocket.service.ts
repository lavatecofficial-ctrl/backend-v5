import { Injectable } from '@nestjs/common';
import { WebSocket } from 'ws';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AviatorWs } from '../../entities/aviator-ws.entity';
import { Bookmaker } from '../../entities/bookmaker.entity';
import { AviatorGateway } from '../../gateways/aviator.gateway';
import { AviatorLoggerWrapper } from '../../config/winston.config';
import { PredictorService } from '../../services/predictor/predictor.service';

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
export class GoBetWebSocketService {
  private readonly logger = new AviatorLoggerWrapper();
  private connections: Map<number, Connection> = new Map();
  private roundData: Map<number, RoundData> = new Map();
  private pingIntervals: Map<number, NodeJS.Timeout> = new Map();
  private maxRetries: number = 10;
  private retryDelay: number = 3000;
  private io: any = null;
  private isResetting: boolean = false;
  private connectingBookmakers: Set<number> = new Set();
  private predictionInFlight: Set<number> = new Set();

  constructor(
    @InjectRepository(AviatorWs)
    private aviatorWsRepository: Repository<AviatorWs>,
    @InjectRepository(Bookmaker)
    private bookmakerRepository: Repository<Bookmaker>,
    private gateway: AviatorGateway,
    private predictorService: PredictorService,
  ) {}

  async initializeConnections(io: any): Promise<void> {
    this.io = this.gateway.getServer();
    
    if (!this.io) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      this.io = this.gateway.getServer();
      
      if (!this.io) {
        throw new Error('Gateway server no disponible para GoBet');
      }
    }
    
    this.logger.log('✅ Inicializando conexiones GoBet WebSocket (ws://)');
    
    try {
      const bookmakers = await this.getGoBetBookmakers();
      console.log(`📊 [GOBET-SERVICE] Bookmakers encontrados: ${bookmakers.length}`);
      
      for (const bookmaker of bookmakers) {
        console.log(`🔍 [GOBET-SERVICE] Procesando bookmaker ${bookmaker.id} (${bookmaker.bookmaker})`);
        if (this.isValidGoBetBookmaker(bookmaker)) {
          console.log(`✅ [GOBET-SERVICE] Bookmaker ${bookmaker.id} válido, conectando...`);
          this.connectToBookmaker(bookmaker, this.io, 0);
        } else {
          console.log(`❌ [GOBET-SERVICE] Bookmaker ${bookmaker.id} NO válido`);
        }
      }

      // Verificar actualizaciones cada minuto
      setInterval(async () => {
        if (this.isResetting) return;
        try {
          const updatedBookmakers = await this.getGoBetBookmakers();
          updatedBookmakers.forEach((bookmaker) => {
            if (this.isValidGoBetBookmaker(bookmaker) && !this.connections.has(bookmaker.id)) {
              this.connectToBookmaker(bookmaker, this.io, 0);
            }
          });
        } catch (error) {
          this.logger.error('[GOBET] Error checking bookmakers:', error);
        }
      }, 60000);
    } catch (error) {
      this.logger.error('[GOBET] Error initializing connections:', error);
    }
  }

  private isValidGoBetBookmaker(bookmaker: BookmakerWithConfig): boolean {
    const { url_websocket, api_message, auth_message, ping_message } = bookmaker;
    
    // Validar que tenga ws:// y mensajes JSON
    const isValid = Boolean(
      url_websocket &&
      url_websocket.startsWith('ws://') &&
      api_message &&
      auth_message &&
      ping_message
    );
    
    console.log(`${isValid ? '✅' : '❌'} [GOBET-VALIDATION] Bookmaker ${bookmaker.id} - URL: ${url_websocket}`);
    return isValid;
  }

  private async getGoBetBookmakers(): Promise<BookmakerWithConfig[]> {
    const aviatorConfigs = await this.aviatorWsRepository.find({
      relations: ['bookmaker'],
      where: { 
        gameId: 1, // Aviator
        bookmaker: {
          isActive: true
        }
      }
    });

    // Filtrar solo los que usan ws:// (GoBet)
    return aviatorConfigs
      .filter(config => config.url_websocket && config.url_websocket.startsWith('ws://'))
      .map(config => ({
        ...config.bookmaker,
        url_websocket: config.url_websocket,
        api_message: config.api_message || '',
        auth_message: config.auth_message || '',
        ping_message: config.ping_message || ''
      }));
  }

  private connectToBookmaker(bookmaker: BookmakerWithConfig, io: any, retryCount: number): void {
    const { id, bookmaker: name, url_websocket, api_message, auth_message, ping_message } = bookmaker;
    
    if (this.connectingBookmakers.has(id)) {
      return;
    }

    const existingConnection = this.connections.get(id);
    if (existingConnection && existingConnection.status === 'CONNECTED' && existingConnection.ws?.readyState === WebSocket.OPEN) {
      return;
    }

    this.connectingBookmakers.add(id);

    const headers = {
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Origin: 'https://aviator-next.spribegaming.com',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Accept-Language': 'es-419,es;q=0.9',
    };

    try {
      // Limpiar conexión existente
      if (this.connections.has(id)) {
        const connection = this.connections.get(id);
        if (connection?.ws) {
          connection.ws.close(1000, 'Closing for reset');
        }
        clearInterval(this.pingIntervals.get(id));
        this.connections.delete(id);
        this.pingIntervals.delete(id);
        this.roundData.delete(id);
      }

      // Agregar token en la URL como query parameter (API V2)
      const apiToken = process.env.API_WEBSOCKET_KEY || 'e8f7a3c9d2b6e1f4a7c3d8b2e9f1a6c4d7b3e8f2a5c9d6b1e4f7a2c8d3b9e5f1a6c2d7b4e9f3a8c5d1b6e2f7a9c4d8b3e1f5a7c6d2b9e4f8a3c1d5b7e6f2a9';
      const wsUrlWithToken = `${url_websocket}?token=${apiToken}`;
      
      const ws = new WebSocket(wsUrlWithToken, [], { headers });

      this.connections.set(id, { ws, status: 'CONNECTING', lastPing: null });
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
        this.logger.log(`✅ GoBet WebSocket conectado - Bookmaker ${id}`);
        this.connections.set(id, { ws, status: 'CONNECTED', lastPing: new Date() });
        this.connectingBookmakers.delete(id);
      });

      ws.on('message', async (data: Buffer) => {
        try {
          const text = data.toString('utf8');
          const obj = JSON.parse(text);
          
          // API V2: Manejar mensaje de conexión inicial
          if (obj.status === 'connected') {
            return;
          }
          
          // Emitir RAW inmediatamente
          const server = this.gateway.getServer();
          if (server) {
            server.to(`bookmaker:${id}`).emit('aviator_raw', { 
              bookmakerId: id, 
              data: obj,
              protocol: 'gobet'
            });
          }
          
          this.connections.set(id, { ws, status: 'CONNECTED', lastPing: new Date() });
          
          // Procesar datos del juego
          await this.processGameData(id, obj);
          
        } catch (error) {
          this.logger.error(`Error procesando mensaje GoBet: ${error.message}`);
        }
      });

      ws.on('close', (code, reason) => {
        this.logger.warn(`GoBet WebSocket cerrado - Bookmaker ${id} (Code: ${code})`);
        this.connections.set(id, { ws: null, status: 'DISCONNECTED', lastPing: null });
        this.connectingBookmakers.delete(id);
        
        if (!this.isResetting && retryCount < this.maxRetries) {
          setTimeout(() => {
            this.connectToBookmaker(bookmaker, io, retryCount + 1);
          }, this.retryDelay * (retryCount + 1));
        }
      });

      ws.on('error', (error) => {
        this.logger.error(`GoBet WebSocket error - Bookmaker ${id}: ${error.message}`);
        this.connections.set(id, { ws: null, status: 'DISCONNECTED', lastPing: null });
        this.connectingBookmakers.delete(id);
      });

      // Configurar ping (API V2: solo actualizar timestamp, no enviar mensaje)
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          this.connections.set(id, { ws, status: 'CONNECTED', lastPing: new Date() });
        } else if (!this.isResetting) {
          this.connectToBookmaker(bookmaker, io, retryCount + 1);
        }
      }, 10000);

      this.pingIntervals.set(id, pingInterval);
      
    } catch (error) {
      this.logger.error(`Error conectando GoBet bookmaker ${id}: ${error.message}`);
      this.connections.set(id, { ws: null, status: 'DISCONNECTED', lastPing: null });
      this.connectingBookmakers.delete(id);
    }
  }

  private async processGameData(id: number, obj: any): Promise<void> {
    const roundData = this.roundData.get(id);
    if (!roundData) return;

    // Procesar según estructura del mensaje de GoBet
    if (obj.p && obj.p.p) {
      const gameData = obj.p.p;
      const command = obj.p.c;
      
      this.logger.log(`📡 [GoBet ${id}] Comando: ${command}`);
      
      // Detectar crash
      if (command === 'x' && gameData.crashX !== undefined) {
        this.logger.log(`🎯 [GoBet] CRASH detectado para bookmaker ${id}: ${gameData.crashX}x - Round: ${roundData.roundId}`);
        
        roundData.maxMultiplier = gameData.crashX;
        roundData.currentMultiplier = gameData.crashX;
        roundData.gameState = 'End';
        
        // Guardar ronda y emitir historial actualizado
        setTimeout(async () => {
          if (roundData.roundId) {
            await this.saveRoundData(id, gameData.crashX);
            
            // Emitir historial actualizado
            const server = this.gateway.getServer();
            if (server) {
              this.logger.log(`🔄 [GoBet] Obteniendo historial actualizado para bookmaker ${id}...`);
              const updatedHistory = await this.fetchRecentRounds(id, 100);
              this.logger.log(`📊 [GoBet] Historial obtenido: ${updatedHistory.length} rondas`);
              this.logger.log(`📡 [GoBet] Emitiendo al room: bookmaker:${id}`);
              server.to(`bookmaker:${id}`).emit('history', {
                bookmakerId: id,
                rounds: updatedHistory
              });
              this.logger.log(`✅ [GoBet] Historial actualizado emitido - ${updatedHistory.length} rondas`);
            }
            
            setTimeout(() => this.resetRoundData(id), 4000);
          }
        }, 500);
      }
      // Detectar inicio de ronda
      else if (command === 'changeState' && gameData.state === 1) {
        roundData.gameState = 'Bet';
        roundData.roundId = gameData.roundId || roundData.roundId;
        this.logger.log(`🎮 [GoBet] Nueva ronda iniciada: ${roundData.roundId}`);
      }
      // Actualizar multiplicador en tiempo real
      else if (command === 'x' && gameData.x !== undefined) {
        roundData.currentMultiplier = gameData.x;
        roundData.gameState = 'Run';
      }
    }
  }

  private async saveRoundData(bookmakerId: number, crashMultiplier: number): Promise<void> {
    const roundData = this.roundData.get(bookmakerId);
    if (!roundData || !roundData.roundId) return;

    try {
      await this.aviatorWsRepository.query(
        `INSERT INTO aviator_rounds 
         (bookmaker_id, round_id, max_multiplier, total_bet_amount, total_cashout, casino_profit, bets_count, online_players)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (bookmaker_id, round_id) DO UPDATE SET
         max_multiplier = EXCLUDED.max_multiplier,
         total_bet_amount = EXCLUDED.total_bet_amount,
         total_cashout = EXCLUDED.total_cashout,
         casino_profit = EXCLUDED.casino_profit,
         bets_count = EXCLUDED.bets_count,
         online_players = EXCLUDED.online_players`,
        [
          bookmakerId,
          roundData.roundId,
          crashMultiplier,
          roundData.totalBetAmount || 0,
          roundData.totalCashout || 0,
          (roundData.totalBetAmount || 0) - (roundData.totalCashout || 0),
          roundData.betsCount || 0,
          roundData.onlinePlayers || 0
        ]
      );
      this.logger.log(`💾 [GoBet] Ronda guardada: ${roundData.roundId} - ${crashMultiplier}x`);
    } catch (error) {
      this.logger.error(`❌ [GoBet] Error guardando ronda: ${error.message}`);
    }
  }

  private async fetchRecentRounds(bookmakerId: number, limit: number = 100): Promise<any[]> {
    // Obtener las últimas N rondas en orden descendente, luego invertir para tener ASC
    const rows = await this.aviatorWsRepository.query(
      `SELECT round_id, max_multiplier, total_bet_amount, total_cashout, casino_profit, bets_count, online_players, created_at
       FROM aviator_rounds
       WHERE bookmaker_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [bookmakerId, limit]
    );

    // Invertir el array para que quede en orden ASC (más antigua primero, más reciente al final)
    return rows.reverse().map((r: any) => ({
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

  private resetRoundData(bookmakerId: number): void {
    const roundData = this.roundData.get(bookmakerId);
    if (roundData) {
      roundData.betsCount = 0;
      roundData.totalBetAmount = 0;
      roundData.totalCashout = 0;
      roundData.onlinePlayers = 0;
      roundData.currentMultiplier = 0;
      roundData.maxMultiplier = 0;
      roundData.gameState = 'Bet';
    }
  }

  getConnectionsStatus() {
    const connections = Array.from(this.connections.entries()).map(([bookmakerId, connection]) => ({
      bookmakerId,
      status: connection.status,
      lastPing: connection.lastPing,
      roundId: this.roundData.get(bookmakerId)?.roundId || null,
    }));

    return {
      totalConnections: connections.length,
      connected: connections.filter(c => c.status === 'CONNECTED').length,
      connections,
    };
  }
}
