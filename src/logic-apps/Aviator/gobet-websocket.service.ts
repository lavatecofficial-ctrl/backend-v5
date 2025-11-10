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
    console.log('🔌 [GOBET-SERVICE] Iniciando servicio GoBet WebSocket...');
    this.io = this.gateway.getServer();
    
    if (!this.io) {
      this.logger.error('❌ ERROR: Gateway server es null');
      await new Promise(resolve => setTimeout(resolve, 2000));
      this.io = this.gateway.getServer();
      
      if (!this.io) {
        throw new Error('Gateway server no disponible para GoBet');
      }
    }
    
    this.logger.log('✅ Inicializando conexiones WebSocket de GoBet (protocolo ws://)');
    
    try {
      const bookmakers = await this.getGoBetBookmakers();
      console.log(`📊 [GOBET-SERVICE] Bookmakers GoBet encontrados: ${bookmakers.length}`);
      
      for (const bookmaker of bookmakers) {
        if (this.isValidGoBetBookmaker(bookmaker)) {
          console.log(`✅ [GOBET-SERVICE] Conectando a GoBet bookmaker ${bookmaker.id}`);
          this.connectToBookmaker(bookmaker, this.io, 0);
        } else {
          console.log(`❌ [GOBET-SERVICE] Bookmaker ${bookmaker.id} inválido`);
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
      console.log(`⚠️ [GOBET] Ya conectando a bookmaker ${id}`);
      return;
    }

    const existingConnection = this.connections.get(id);
    if (existingConnection && existingConnection.status === 'CONNECTED' && existingConnection.ws?.readyState === WebSocket.OPEN) {
      console.log(`✅ [GOBET] Ya conectado a bookmaker ${id}`);
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

      // Agregar el token de API como query parameter en la URL
      const apiKey = process.env.API_WEBSOCKET_KEY || 'e8f7a3c9d2b6e1f4a7c3d8b2e9f1a6c4d7b3e8f2a5c9d6b1e4f7a2c8d3b9e5f1a6c2d7b4e9f3a8c5d1b6e2f7a9c4d8b3e1f5a7c6d2b9e4f8a3c1d5b7e6f2a9';
      const wsUrl = `${url_websocket}?token=${apiKey}`;
      
      console.log(`🔌 [GOBET] Conectando a ${wsUrl.substring(0, 60)}... para bookmaker ${id}`);
      const ws = new WebSocket(wsUrl, [], { headers });

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
        console.log(`✅ [GOBET] WebSocket conectado para bookmaker ${id}`);
        this.connections.set(id, { ws, status: 'CONNECTED', lastPing: new Date() });
        this.connectingBookmakers.delete(id);
        console.log(`👂 [GOBET] Escuchando mensajes del servidor (sin enviar handshake)...`);
      });

      ws.on('message', async (data: Buffer) => {
        try {
          const text = data.toString('utf8');
          const obj = JSON.parse(text);
          
          // Emitir RAW inmediatamente
          const server = this.gateway.getServer();
          if (server) {
            server.to(`bookmaker:${id}`).emit('aviator_raw', { 
              bookmakerId: id, 
              data: obj,
              protocol: 'gobet'
            });
          }
          
          // Procesar mensajes del juego para guardar rondas
          if (obj.a === 13 && obj.c === 1) {
            await this.processGameMessage(id, obj.p?.c, obj.p?.p, server);
          }
          
          // Enviar auth_message después de recibir respuesta del handshake (c=0, a=0)
          if (!(ws as any).authSent && obj.c === 0 && obj.a === 0) {
            try {
              // Parsear auth_message que viene de la BD como JSON
              const authMsg = JSON.parse(auth_message);
              
              // Enviar en el formato correcto para GoBet
              const authPayload = {
                c: 0,
                a: 1,
                ...authMsg // Incluir todas las credenciales del auth_message
              };
              
              ws.send(JSON.stringify(authPayload));
              console.log(`📤 [GOBET] Auth enviado para bookmaker ${id}:`, JSON.stringify(authPayload).substring(0, 300));
              (ws as any).authSent = true;
            } catch (error) {
              console.error(`❌ [GOBET] Error parseando auth_message:`, error);
              console.error(`❌ [GOBET] auth_message content:`, auth_message.substring(0, 500));
            }
          }
          
          // Log respuesta de autenticación
          if (obj.c === 0 && obj.a === 1) {
            if (obj.p && obj.p.success) {
              console.log(`✅ [GOBET] AUTH EXITOSO para bookmaker ${id}`);
            } else {
              console.error(`❌ [GOBET] AUTH FALLIDO para bookmaker ${id}:`, JSON.stringify(obj));
            }
          }
          
          this.connections.set(id, { ws, status: 'CONNECTED', lastPing: new Date() });
        } catch (error) {
          console.error(`❌ [GOBET] Error procesando mensaje de bookmaker ${id}:`, error);
        }
      });

      ws.on('close', (code, reason) => {
        console.log(`🔴 [GOBET] WebSocket cerrado para bookmaker ${id}. Code: ${code}, Reason: ${reason}`);
        this.connections.set(id, { ws: null, status: 'DISCONNECTED', lastPing: null });
        this.connectingBookmakers.delete(id);
        
        if (!this.isResetting && retryCount < this.maxRetries) {
          setTimeout(() => {
            this.connectToBookmaker(bookmaker, io, retryCount + 1);
          }, this.retryDelay * (retryCount + 1));
        }
      });

      ws.on('error', (error) => {
        console.error(`❌ [GOBET] Error en WebSocket para bookmaker ${id}:`, error.message);
        this.connections.set(id, { ws: null, status: 'DISCONNECTED', lastPing: null });
        this.connectingBookmakers.delete(id);
      });

      // Configurar ping
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN && ping_message) {
          try {
            const pingMsg = JSON.parse(ping_message);
            ws.send(JSON.stringify(pingMsg));
            console.log(`📤 [GOBET-PING] Ping enviado para bookmaker ${id}`);
          } catch (error) {
            console.error(`❌ [GOBET] Error parseando ping_message:`, error);
          }
          
          this.connections.set(id, { ws, status: 'CONNECTED', lastPing: new Date() });
        }
      }, 10000);

      this.pingIntervals.set(id, pingInterval);
      
    } catch (error) {
      console.error(`❌ [GOBET] Error conectando bookmaker ${id}:`, error);
      this.connections.set(id, { ws: null, status: 'DISCONNECTED', lastPing: null });
      this.connectingBookmakers.delete(id);
    }
  }

  private async processGameMessage(id: number, command: string, payload: any, server: any): Promise<void> {
    const roundData = this.roundData.get(id);
    if (!roundData) return;

    try {
      switch (command) {
        case 'changeState':
          // Detectar fin de ronda (state 3 = END)
          if (payload.state === 3 && roundData.roundId && roundData.maxMultiplier > 0) {
            await this.saveRoundData(id, roundData.maxMultiplier);
            
            // Emitir historial actualizado
            if (this.io) {
              const updatedHistory = await this.fetchRecentRounds(id, 100);
              this.io.to(`bookmaker:${id}`).emit('history', {
                bookmakerId: id,
                rounds: updatedHistory
              });
              console.log(`✅ [GOBET] Historial actualizado emitido - ${updatedHistory.length} rondas`);
            }
          }
          
          // Actualizar roundId
          if (payload.roundId) {
            roundData.roundId = payload.roundId;
          }
          
          // Resetear datos al empezar nueva ronda (state 1 = BET)
          if (payload.state === 1) {
            this.resetRoundData(id);
          }
          break;
          
        case 'x':
          // Actualizar multiplicador
          if (payload.x) {
            roundData.currentMultiplier = payload.x;
            if (payload.crashX) {
              roundData.maxMultiplier = payload.crashX;
            }
          }
          break;
          
        case 'updateCurrentBets':
          // Actualizar apuestas
          if (payload.betsCount !== undefined) {
            roundData.betsCount = payload.betsCount;
          }
          if (payload.bets && Array.isArray(payload.bets)) {
            roundData.totalBetAmount = payload.bets.reduce((sum: number, bet: any) => sum + (bet.bet || 0), 0);
            roundData.onlinePlayers = new Set(payload.bets.map((bet: any) => bet.player_id)).size;
          }
          break;
          
        case 'updateCurrentCashOuts':
          // Actualizar cashouts
          if (payload.cashouts && Array.isArray(payload.cashouts)) {
            payload.cashouts.forEach((cashout: any) => {
              const cashoutId = `${cashout.betId}`;
              if (!roundData.cashoutRecords.has(cashoutId)) {
                roundData.cashoutRecords.add(cashoutId);
                roundData.totalCashout += cashout.win || 0;
              }
            });
          }
          break;
      }
    } catch (error) {
      console.error(`❌ [GOBET] Error procesando mensaje ${command}:`, error);
    }
  }

  private async saveRoundData(bookmaker_id: number, crashX: number): Promise<void> {
    const roundData = this.roundData.get(bookmaker_id);
    if (!roundData || !roundData.roundId) return;

    try {
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

      console.log(`✅ [GOBET] Ronda ${roundData.roundId} guardada - Crash: ${crashX}x`);
    } catch (error) {
      console.error(`❌ [GOBET] Error guardando ronda:`, error);
    }
  }

  private async fetchRecentRounds(
    bookmakerId: number,
    limit: number = 100,
  ): Promise<Array<{
    round_id: string;
    max_multiplier: number;
    total_bet_amount: number;
    total_cashout: number;
    casino_profit: number;
    bets_count: number;
    online_players: number;
    created_at: string;
  }>> {
    // Primero obtener las últimas N rondas en DESC, luego invertir a ASC
    const rows = await this.aviatorWsRepository.query(
      `SELECT round_id, max_multiplier, total_bet_amount, total_cashout, casino_profit, bets_count, online_players, created_at
       FROM aviator_rounds
       WHERE bookmaker_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [bookmakerId, limit]
    );

    // Invertir para que queden en orden ASC (más antiguas primero)
    return rows.reverse().map((r: any) => ({
      round_id: r.round_id,
      max_multiplier: Number(r.max_multiplier),
      total_bet_amount: Number(r.total_bet_amount),
      total_cashout: Number(r.total_cashout),
      casino_profit: Number(r.casino_profit),
      bets_count: Number(r.bets_count),
      online_players: Number(r.online_players),
      created_at: r.created_at,
    }));
  }

  private resetRoundData(bookmaker_id: number): void {
    const current = this.roundData.get(bookmaker_id);
    this.roundData.set(bookmaker_id, {
      betsCount: 0,
      totalBetAmount: 0,
      onlinePlayers: 0,
      roundId: current?.roundId || null,
      maxMultiplier: 0,
      currentMultiplier: 0,
      totalCashout: 0,
      cashoutRecords: new Set(),
      gameState: 'Bet',
    });
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
