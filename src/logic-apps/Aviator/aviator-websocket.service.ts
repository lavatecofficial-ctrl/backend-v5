import { Injectable } from '@nestjs/common';
import { WebSocket } from 'ws';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AviatorWs } from '../../entities/aviator-ws.entity';
import { Bookmaker } from '../../entities/bookmaker.entity';
import { AviatorGateway } from '../../gateways/aviator.gateway';
import { AviatorLoggerWrapper } from '../../config/winston.config';
import { PredictorService } from '../../services/predictor/predictor.service';
import { decodeMessage } from './decoder';

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
  nombre?: string; // Campo opcional para compatibilidad
}

@Injectable()
export class AviatorWebSocketService {
  private readonly logger = new AviatorLoggerWrapper();
  private connections: Map<number, Connection> = new Map();
  private roundData: Map<number, RoundData> = new Map();
  private pingIntervals: Map<number, NodeJS.Timeout> = new Map();
  private maxRetries: number = 10; // Aumentar intentos de reconexión
  private retryDelay: number = 3000; // Reducir delay inicial
  private io: any = null;
  private isResetting: boolean = false;
  private connectingBookmakers: Set<number> = new Set(); // Prevenir conexiones múltiples simultáneas
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
    console.log('🔌 [AVIATOR-SERVICE] >>> initializeConnections LLAMADO <<<');
    this.io = this.gateway.getServer(); // USAR EL GATEWAY DIRECTAMENTE
    
    console.log('🔌 [AVIATOR-SERVICE] Gateway.getServer() =', this.io ? 'OK' : 'NULL');
    
    if (!this.io) {
      this.logger.error('❌ ERROR: Gateway server es null. Esperando 2 segundos...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      this.io = this.gateway.getServer();
      
      if (!this.io) {
        this.logger.error('❌ ERROR CRÍTICO: No se pudo obtener el servidor del gateway');
        throw new Error('Gateway server no disponible');
      }
    }
    
    this.logger.log('✅ Inicializando conexiones WebSocket de Aviator');
    console.log('🔄 [AVIATOR-SERVICE] Obteniendo bookmakers...');
    
    try {
      const bookmakers = await this.getBookmakersWithConfigs();
      console.log(`📊 [AVIATOR-SERVICE] Bookmakers encontrados: ${bookmakers.length}`);
      
      for (const bookmaker of bookmakers) {
        console.log(`🔍 [AVIATOR-SERVICE] Procesando bookmaker ${bookmaker.id} (${bookmaker.bookmaker})`);
        console.log(`   - URL WebSocket: ${bookmaker.url_websocket || 'NO CONFIGURADO'}`);
        
        if (this.isValidBookmaker(bookmaker)) {
          console.log(`✅ [AVIATOR-SERVICE] Bookmaker ${bookmaker.id} válido, conectando...`);
          this.connectToBookmaker(bookmaker, this.io, 0);
        } else {
          console.log(`❌ [AVIATOR-SERVICE] Bookmaker ${bookmaker.id} inválido, omitiendo`);
          this.logger.warn(`Configuración inválida para bookmaker ${bookmaker.id}, omitiendo conexión`);
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
              this.connectToBookmaker(bookmaker, io, 0);
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
    const { url_websocket } = bookmaker;
    
    // SOLO validar WebSocket seguro (wss://) - Protocolo nuevo (JSON + base64)
    // El protocolo ws:// (GoBet) se maneja en gobet-websocket.service.ts
    if (url_websocket && url_websocket.startsWith('wss://')) {
      console.log(`✅ [VALIDATION-WSS] Bookmaker ${bookmaker.id} usa wss://`);
      return true;
    }
    
    console.log(`❌ [VALIDATION-WSS] Bookmaker ${bookmaker.id} NO usa wss://, omitiendo (URL: ${url_websocket})`);
    return false;
  }

  private async getBookmakersWithConfigs(): Promise<BookmakerWithConfig[]> {
    const aviatorConfigs = await this.aviatorWsRepository.find({
      relations: ['bookmaker'],
      where: { 
        gameId: 1, // Aviator game ID
        bookmaker: {
          isActive: true // Solo bookmakers activos
        }
      }
    });

    // Filtrar SOLO bookmakers con wss:// (los ws:// se manejan en gobet-websocket.service.ts)
    return aviatorConfigs
      .filter(config => config.url_websocket && config.url_websocket.startsWith('wss://'))
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
    
    // LOG: Mostrar qué auth_message está usando
    this.logger.log(`🔑 [DEBUG] Bookmaker ${id} - auth_message: ${auth_message ? auth_message.substring(0, 50) + '...' : 'NULL'}`);
    
    // Prevenir conexiones múltiples simultáneas para el mismo bookmaker
    if (this.connectingBookmakers.has(id)) {
      this.logger.log(`Ya se está conectando al bookmaker ${id}, saltando conexión duplicada`);
      return;
    }

    // Verificar si ya hay una conexión activa
    const existingConnection = this.connections.get(id);
    if (existingConnection && existingConnection.status === 'CONNECTED' && existingConnection.ws?.readyState === WebSocket.OPEN) {
      this.logger.log(`WebSocket ya está conectado para bookmaker ${id}, saltando conexión`);
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
      this.updateWebSocketStatusInDB(id, 'CONNECTING'); // Actualizar estado en BD
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

      // Determinar protocolo
      const isLegacyProtocol = url_websocket.startsWith('ws://');
      console.log(`📡 [CONNECT] Bookmaker ${id} usa protocolo ${isLegacyProtocol ? 'LEGACY (base64)' : 'NUEVO (JSON)'}`);

      ws.on('open', () => {
        this.logger.log(`WebSocket connected for bookmaker ${id}`);
        this.connections.set(id, { ws, status: 'CONNECTED', lastPing: new Date() });
        this.connectingBookmakers.delete(id); // Remover del set de conexiones en progreso
        this.updateWebSocketStatusInDB(id, 'CONNECTED'); // Actualizar estado en BD
        
        if (isLegacyProtocol) {
          // Protocolo legacy (gobet): enviar api_message en base64
          console.log(`📤 [LEGACY] Enviando api_message en base64 para bookmaker ${id}`);
          ws.send(Buffer.from(api_message, 'base64'));
        } else {
          // Protocolo nuevo (888starz, etc): enviar handshake JSON
          console.log(`📤 [JSON] Enviando handshake JSON para bookmaker ${id}`);
          const handshake = {
            c: 0,
            a: 0,
            p: {
              api: '1.8.4',
              cl: 'Node.js'
            }
          };
          ws.send(JSON.stringify(handshake));
        }
      });

      ws.on('message', async (data: Buffer) => {
        try {
          let obj: any;
          
          if (isLegacyProtocol) {
            // Protocolo legacy: decodificar mensaje binario
            const decodedMessage = decodeMessage(data);
            if (!decodedMessage) return;
            
            this.connections.set(id, { ws, status: 'CONNECTED', lastPing: new Date() });

            // Enviar auth_message después del primer mensaje
            if (!(ws as any).firstResponseReceived) {
              console.log(`📤 [LEGACY] Enviando auth_message en base64 para bookmaker ${id}`);
              ws.send(Buffer.from(auth_message, 'base64'));
              (ws as any).firstResponseReceived = true;
            }

            obj = decodedMessage;
            console.log(`📥 [LEGACY] Mensaje decodificado para bookmaker ${id}`);
          } else {
            // Protocolo nuevo: parsear JSON
            const text = data.toString('utf8');
            obj = JSON.parse(text);
            console.log(`📥 [JSON] Mensaje JSON recibido para bookmaker ${id}`);
          }
          
          // EMITIR RAW INMEDIATAMENTE para ambos protocolos
          const server = this.gateway.getServer();
          if (server) {
            // Emitir SOLO a la sala específica del bookmaker
            server.to(`bookmaker:${id}`).emit('aviator_raw', { bookmakerId: id, data: obj, protocol: isLegacyProtocol ? 'legacy' : 'json' });
            
            // Log cada 100 mensajes para verificar
            if (Math.random() < 0.01) {
              this.logger.log(`📡 Emitiendo aviator_raw para bookmaker ${id} (${isLegacyProtocol ? 'legacy' : 'json'})`);
            }
          } else {
            this.logger.error(`>>> ERROR: Gateway server es null, no se puede emitir aviator_raw`);
          }
          
          // Procesar autenticación para protocolo JSON
          if (!isLegacyProtocol && obj.a === 13 && obj.c === 1) {
            // Continuar con lógica existente...
          }
          
          // Procesar autenticación SOLO para protocolo JSON
          if (!isLegacyProtocol) {
            // Manejar handshake response y enviar autenticación
            if (obj.c === 0 && obj.a === 0 && obj.p && obj.p.tk) {
              const envUsername = process.env.AVIATOR_API_USERNAME || 'grupoaviatorcolombia';
              const envToken = process.env.AVIATOR_API_TOKEN || 'e8f7a3c9d2b6e1f4a7c3d8b2e9f1a6c4d7b3e8f2a5c9d6b1e4f7a2c8d3b9e5f1a6c2d7b4e9f3a8c5d1b6e2f7a9c4d8b3e1f5a7c6d2b9e4f8a3c1d5b7e6f2a9';
              
              const auth = {
                c: 0,
                a: 1,
                un: '',
                pw: '',
                zn: '',
                p: {
                  p: {
                    username: envUsername,
                    token: envToken
                  }
                }
              };
              ws.send(JSON.stringify(auth));
              this.logger.log(`Aviator: AUTH enviado para bookmaker ${id} (JSON)`);
            }
            
            // Log de respuesta de autenticación
            if (obj.c === 0 && obj.a === 1) {
              if (obj.p && obj.p.success) {
                this.logger.log(`Aviator: AUTH EXITOSO para bookmaker ${id} (JSON) - ${obj.p.username}`);
              } else {
                this.logger.error(`Aviator: AUTH FALLIDO para bookmaker ${id} (JSON): ${JSON.stringify(obj)}`);
              }
            }
          }
          
          this.connections.set(id, { ws, status: 'CONNECTED', lastPing: new Date() });

          const roundData = this.roundData.get(id);
          if (!roundData) return;
          
          // Normalizar estructura según protocolo
          let gameMessage: any;
          
          if (isLegacyProtocol) {
            // Protocolo legacy: estructura obj.p.p
            if (!obj.p || !obj.p.p) return;
            gameMessage = obj.p;
          } else {
            // Protocolo JSON: estructura obj.p (canal 13)
            if (obj.a !== 13 || obj.c !== 1 || !obj.p) return;
            gameMessage = { p: obj.p, c: obj.p.c };
          }
          
          const decodedMessage = gameMessage;

          if (decodedMessage.p) {
            const { p, c } = decodedMessage.p;
            
            // Log de TODOS los comandos para debug
            if (c !== 'x' || (c === 'x' && p.crashX !== undefined)) {
              this.logger.log(`📡 [${name}] Comando recibido: ${c}`, p.crashX ? `crashX=${p.crashX}` : '');
            }

            if (c === 'updateCurrentBets') {
              // Solo actualizar durante estado Bet (o si aún no hay estado definido)
              if (roundData.gameState === 'Bet' || !roundData.gameState) {
                roundData.betsCount = p.betsCount || 0;
                roundData.totalBetAmount = p.bets?.reduce((sum: number, bet: any) => sum + (bet.bet || 0), 0) || 0;
                
                // Contar jugadores únicos
                const uniquePlayers = new Set(p.bets?.map((bet: any) => bet.player_id) || []);
                roundData.onlinePlayers = uniquePlayers.size || p.activePlayersCount || 0;
                
                this.logger.log(`💰 Apuestas actualizadas - Round: ${roundData.roundId}, Apuestas: ${roundData.betsCount}, Total: $${roundData.totalBetAmount}, Jugadores: ${roundData.onlinePlayers}`);
              }
            } else if (c === 'changeState') {
              if (p.state === 1) {
                roundData.gameState = 'Bet';
                roundData.roundId = p.roundId || roundData.roundId;
                roundData.currentMultiplier = 0;
                if (p.roundId && this.io) {
                  this.io.to(`bookmaker:${id}`).emit('roundStart', {
                    roundId: p.roundId,
                    gameState: 'Bet',
                  });
                }
                // Disparar predicción al inicio de la ronda
                if (p.roundId) {
                  this.triggerPrediction(id).catch(err => {
                    this.logger.error(`Error triggering Aviator prediction for bookmaker ${id}: ${err?.message || err}`);
                  });
                }
              } else if (p.state === 2) {
                roundData.gameState = 'Run';
                roundData.roundId = p.roundId || roundData.roundId;
                roundData.currentMultiplier = 0;
              }
            } else if (c === 'updateCurrentCashOuts') {
              // Usar el total que ya viene calculado
              if (p.totalCashOut !== undefined) {
                roundData.totalCashout = p.totalCashOut;
              }
            } else if (c === 'x') {
              this.logger.log(`🔍 [DEBUG] Evento 'x' recibido para bookmaker ${id}. Payload:`, JSON.stringify(p));
              if (p.crashX !== undefined) {
                this.logger.log(`🎯 CRASH detectado para bookmaker ${id}: ${p.crashX}x - Round: ${roundData.roundId}`);
                this.logger.log(`📊 Datos de la ronda: Apuestas=${roundData.betsCount}, Total=${roundData.totalBetAmount}, Jugadores=${roundData.onlinePlayers}, Cashout=${roundData.totalCashout}`);
                
                roundData.maxMultiplier = p.crashX || 0;
                roundData.currentMultiplier = p.crashX || 0;
                roundData.gameState = 'End';
                
                // Esperar 500ms para asegurarnos de que el roundId haya llegado
                setTimeout(async () => {
                  if (roundData.roundId) {
                    await this.saveRoundData(id, name, p.crashX);
                    
                    // Emitir historial actualizado al frontend
                    if (this.io) {
                      this.logger.log(`🔄 Obteniendo historial actualizado para bookmaker ${id}...`);
                      const updatedHistory = await this.fetchRecentRounds(id, 100);
                      this.logger.log(`📊 Historial obtenido: ${updatedHistory.length} rondas`);
                      this.logger.log(`🎯 Primera ronda: ${updatedHistory[0]?.round_id} - ${updatedHistory[0]?.max_multiplier}x`);
                      this.logger.log(`📡 Emitiendo al room: bookmaker:${id}`);
                      this.io.to(`bookmaker:${id}`).emit('history', {
                        bookmakerId: id,
                        rounds: updatedHistory
                      });
                      this.logger.log(`✅ Historial actualizado emitido para bookmaker ${id} - ${updatedHistory.length} rondas`);
                    } else {
                      this.logger.error(`❌ ERROR: this.io es NULL, no se puede emitir historial para bookmaker ${id}`);
                    }
                    
                    setTimeout(() => this.resetRoundData(id), 4000);
                  } else {
                    this.logger.warn(`⚠️ No hay roundId después de esperar para guardar el crash ${p.crashX}x`);
                  }
                }, 500);
              } else {
                roundData.currentMultiplier = p.x || 0;
                roundData.gameState = 'Run';
                if (this.io) {
                  const multiplierData = {
                    bookmakerId: id,
                    current_multiplier: roundData.currentMultiplier.toFixed(2),
                  };
                  // this.logger.log(`Emitiendo multiplicador para bookmaker ${id}: ${JSON.stringify(multiplierData)}`);
                  this.io.to(`bookmaker:${id}`).emit('multiplier', multiplierData);
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
              const roundDataToEmit = {
                online_players: roundData.onlinePlayers,
                bets_count: roundData.betsCount,
                total_bet_amount: roundData.totalBetAmount,
                total_cashout: roundData.totalCashout,
                current_multiplier: roundData.currentMultiplier,
                max_multiplier: roundData.maxMultiplier,
                game_state: roundData.gameState,
                casino_profit: Number(casinoProfit.toFixed(2)),
                round_id: roundData.roundId,
              };
              // this.logger.log(`Emitiendo datos de ronda para bookmaker ${id}: ${JSON.stringify(roundDataToEmit)}`);
              this.io.to(`bookmaker:${id}`).emit('round', roundDataToEmit);
            }
          }
        } catch (error) {
          this.logger.error(`Error processing message for bookmaker ${id}:`, error);
        }
      });

      ws.on('error', (error: Error) => {
        this.logger.error(`WebSocket error for bookmaker ${id}: ${error.message}`);
        
        // Solo actualizar estado si realmente está desconectado
        if (ws.readyState === WebSocket.CLOSED) {
          this.connections.set(id, { ws, status: 'DISCONNECTED', lastPing: this.connections.get(id)?.lastPing || null });
          this.updateWebSocketStatusInDB(id, 'DISCONNECTED'); // Actualizar estado en BD
          
          // Solo reconectar si no estamos reseteando
          if (!this.isResetting) {
            this.handleReconnect(bookmaker, io, retryCount);
          }
        } else {
          // Si el WebSocket sigue abierto, solo loggear el error pero no cambiar estado
          this.logger.warn(`WebSocket error pero conexión sigue activa para bookmaker ${id}: ${error.message}`);
        }
      });

      ws.on('close', async (code: number, reason: Buffer) => {
        this.logger.log(`WebSocket closed for bookmaker ${id} (code: ${code}, reason: ${reason || 'No reason provided'})`);
        this.connections.set(id, { ws, status: 'DISCONNECTED', lastPing: this.connections.get(id)?.lastPing || null });
        this.updateWebSocketStatusInDB(id, 'DISCONNECTED'); // Actualizar estado en BD
        this.connectingBookmakers.delete(id); // Remover del set de conexiones en progreso
        
        // Limpiar interval de PING
        clearInterval(this.pingIntervals.get(id));
        this.pingIntervals.delete(id);
        
        // Guardar datos de la ronda si es necesario
        const roundData = this.roundData.get(id);
        if (roundData?.roundId && roundData.maxMultiplier > 0) {
          await this.saveRoundData(id, name, roundData.maxMultiplier);
        }
        
        // Solo reconectar si no estamos reseteando
        if (!this.isResetting) {
          this.handleReconnect(bookmaker, io, retryCount);
        }
      });

      // Configurar ping según protocolo
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          if (isLegacyProtocol && ping_message) {
            // Protocolo legacy: enviar ping_message en base64
            ws.send(Buffer.from(ping_message, 'base64'));
            console.log(`📤 [LEGACY-PING] Enviando ping para bookmaker ${id}`);
          }
          // Protocolo JSON no requiere ping manual
          
          this.connections.set(id, { 
            ws, 
            status: 'CONNECTED', 
            lastPing: new Date() 
          });
        } else {
          this.logger.log(`WebSocket not OPEN for bookmaker ${id}, state: ${ws.readyState}`);
          if (!this.isResetting) {
            this.handleReconnect(bookmaker, io, retryCount);
          }
        }
      }, 10000);

      this.pingIntervals.set(id, pingInterval);
    } catch (error) {
      this.logger.error(`Failed to connect WebSocket for bookmaker ${id}:`, error);
      this.connections.set(id, { ws: null, status: 'DISCONNECTED', lastPing: null });
      this.updateWebSocketStatusInDB(id, 'DISCONNECTED'); // Actualizar estado en BD
      this.connectingBookmakers.delete(id); // Remover del set de conexiones en progreso
      if (!this.isResetting) {
        this.handleReconnect(bookmaker, io, retryCount);
      }
    }
  }

  private handleReconnect(bookmaker: BookmakerWithConfig, io: any, retryCount: number): void {
    // Verificar si ya hay una conexión activa antes de reconectar
    const existingConnection = this.connections.get(bookmaker.id);
    if (existingConnection && existingConnection.status === 'CONNECTED' && existingConnection.ws?.readyState === WebSocket.OPEN) {
      this.logger.log(`WebSocket ya está conectado para bookmaker ${bookmaker.id}, saltando reconexión`);
      return;
    }

    // Actualizar estado a CONNECTING cuando se inicia reconexión
    this.updateWebSocketStatusInDB(bookmaker.id, 'CONNECTING');

    if (retryCount >= this.maxRetries) {
      this.logger.error(`ACTUALIZA TU TOKEN para bookmaker ${bookmaker.id}. Máximo de intentos (${this.maxRetries}) alcanzado.`);
      // En lugar de parar completamente, intentar reconectar después de 5 minutos
      setTimeout(() => {
        this.logger.log(`Reintentando conexión para bookmaker ${bookmaker.id} después de timeout`);
        this.connectToBookmaker(bookmaker, io, 0);
      }, 300000); // 5 minutos
      return;
    }

    // Backoff exponencial con jitter
    const delay = Math.min(this.retryDelay * Math.pow(2, retryCount), 60000) + Math.random() * 1000;
    this.logger.log(`Attempting to reconnect for bookmaker ${bookmaker.id} (Attempt ${retryCount + 1}/${this.maxRetries}) in ${Math.round(delay)}ms`);
    
    setTimeout(() => {
      this.connectToBookmaker(bookmaker, io, retryCount + 1);
    }, delay);
  }

  private async updateWebSocketStatusInDB(bookmakerId: number, status: string): Promise<void> {
    try {
      // Usar save() en lugar de update() para que se ejecute el trigger de updated_at
      const aviatorWs = await this.aviatorWsRepository.findOne({ where: { bookmakerId } });
      if (aviatorWs) {
        aviatorWs.status_ws = status;
        await this.aviatorWsRepository.save(aviatorWs);
        this.logger.log(`Estado WebSocket actualizado en BD para bookmaker ${bookmakerId}: ${status}`);
      }
    } catch (error) {
      this.logger.error(`Error actualizando estado WebSocket en BD para bookmaker ${bookmakerId}:`, error);
    }
  }

  private async saveRoundData(bookmaker_id: number, bookmaker_name: string, crashX: number): Promise<void> {
    const roundData = this.roundData.get(bookmaker_id);
    if (!roundData) return;

    try {
      this.logger.log(`Saving round data for ${bookmaker_name}: Crash at ${crashX}x`);
      
      // Calcular datos adicionales
      const casinoProfit = roundData.totalBetAmount - roundData.totalCashout;
      const lossPercentage = roundData.totalBetAmount > 0 ? 
        ((casinoProfit / roundData.totalBetAmount) * 100) : 0;

      // Insertar en la tabla aviator_rounds
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

      this.logger.log(`✅ Round data saved successfully for ${bookmaker_name} - Round ${roundData.roundId}`);
    } catch (error) {
      this.logger.error(`Error saving round data for bookmaker ${bookmaker_id}:`, error);
    }
  }

  private resetRoundData(bookmaker_id: number): void {
    this.roundData.set(bookmaker_id, {
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
  }

  async resetAllConnections(): Promise<void> {
    try {
      this.isResetting = true;
      this.logger.log('Resetting all WebSocket connections...');

      for (const [bookmakerId, connection] of this.connections) {
        if (connection.ws) {
          connection.ws.close(1000, 'Reset requested');
        }
        clearInterval(this.pingIntervals.get(bookmakerId));
        this.pingIntervals.delete(bookmakerId);
      }

      this.connections.clear();
      this.roundData.clear();
      this.connectingBookmakers.clear(); // Limpiar conexiones en progreso

      this.logger.log('All connections reset successfully');
      
      // Esperar 5 segundos antes de permitir reconexiones automáticas
      setTimeout(() => {
        this.isResetting = false;
        this.logger.log('Reset completed, reconexiones automáticas habilitadas');
      }, 5000);
      
    } catch (error) {
      this.logger.error('Error resetting connections:', error);
      this.isResetting = false;
    }
  }

  // --- Predicción: métodos privados ---
  private async triggerPrediction(bookmakerId: number): Promise<void> {
    if (this.predictionInFlight.has(bookmakerId)) return;
    this.predictionInFlight.add(bookmakerId);
    try {
      // Leer ventana requerida desde variables de entorno, por defecto 200
      const requiredWindowRaw = process.env.PREDICTOR_AVIATOR_WINDOW || process.env.AVIATOR_WINDOW || '200';
      const parsed = Number.parseInt(requiredWindowRaw, 10);
      const windowSize = Number.isFinite(parsed) && parsed > 0 ? parsed : 200;

      const rounds = await this.fetchRecentRounds(bookmakerId, windowSize);
      if (!rounds.length) return;
      // Si la cantidad de rondas no alcanza la ventana requerida, evitar llamar al predictor para no generar error 400
      if (rounds.length < windowSize) {
        this.logger.warn(`No hay suficientes rondas (${rounds.length} < ${windowSize}) para bookmaker ${bookmakerId}. Omitiendo predicción.`);
        return;
      }
      const response = await this.predictorService.predictAviator(rounds as any, bookmakerId);
      if (this.io) {
        this.io.to(`bookmaker:${bookmakerId}`).emit('prediction', {
          bookmakerId,
          ...response,
        });
      }
    } catch (err: any) {
      this.logger.error(`Aviator prediction failed for bookmaker ${bookmakerId}: ${err?.message || err}`);
    } finally {
      this.predictionInFlight.delete(bookmakerId);
    }
  }

  private async fetchRecentRounds(
    bookmakerId: number,
    limit: number = 30,
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
    const rows = await this.aviatorWsRepository.query(
      `SELECT round_id, max_multiplier, total_bet_amount, total_cashout, casino_profit, bets_count, online_players, created_at
       FROM aviator_rounds
       WHERE bookmaker_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [bookmakerId, limit]
    );

    return rows
      .map((r: any) => ({
        round_id: r.round_id,
        max_multiplier: Number(r.max_multiplier),
        total_bet_amount: Number(r.total_bet_amount),
        total_cashout: Number(r.total_cashout),
        casino_profit: Number(r.casino_profit),
        bets_count: Number(r.bets_count),
        online_players: Number(r.online_players),
        created_at: new Date(r.created_at).toISOString(),
      }))
      .reverse();
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