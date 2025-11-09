import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { PredictorService } from '../../services/predictor/predictor.service';
import { Spaceman } from '../../entities/spaceman.entity';
import { SpacemanRound } from '../../entities/spaceman-round.entity';
import { SpacemanTokenService } from './spaceman-token.service';
import { SpacemanLoggerWrapper } from '../../config/winston.config';

interface ConnectionData {
  ws: WebSocket;
  status: 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED';
  retryCount: number;
}

interface RoundData {
  total_bet_amount?: number;
  bets_count?: number;
  total_cashout?: number;
  online_player?: number;
  casino_profit?: number;
}

interface GameRound {
  game_id: string;
  bets_count: number;
  total_bet_amount: number;
  online_player: number;
  max_multiplier: number;
  total_cashout: number;
  casino_profit: number;
}

@Injectable()
export class SpacemanWebSocketService {
  private readonly logger = new SpacemanLoggerWrapper();
  private connections = new Map<string, ConnectionData>();
  private roundData = new Map<number, Record<string, RoundData>>();
  private io: any = null;
  private readonly maxRetries = 3;
  private readonly retryDelay = 5000;
  private readonly logFile: string;
  private readonly multiplierLogFile: string;
  private readonly exchangeRateEurToCop = 4300;
  private connectingSpaceman: Set<number> = new Set(); // Prevenir conexiones duplicadas
  private forceTokenUpdate: boolean = false; // Forzar actualización de tokens
  // Eliminado: Sistema de actualización automática de tokens
  private predictionInFlight: Set<number> = new Set();
  private reconnectingSpaceman: Set<number> = new Set(); // Rastrear reconexiones por session offline
  private reconnectIntervals: Map<number, NodeJS.Timeout> = new Map(); // Intervalos de reconexión cada 5 minutos

  constructor(
    @InjectRepository(Spaceman)
    private spacemanRepository: Repository<Spaceman>,
    @InjectRepository(SpacemanRound)
    private spacemanRoundRepository: Repository<SpacemanRound>,
    private configService: ConfigService,
    private spacemanTokenService: SpacemanTokenService,
    private predictorService: PredictorService,
  ) {
    this.logFile = path.join(process.cwd(), 'logs', 'spaceman_finance.log');
    this.multiplierLogFile = path.join(process.cwd(), 'logs', 'spaceman_multiplier.log');
    this.ensureLogDirectory();
  }

  private ensureLogDirectory(): void {
    const logDir = path.dirname(this.logFile);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
  }

  private logFinanceMessage(spacemanId: number, message: string): void {
    const timestamp = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
    const logEntry = `[${timestamp}] Spaceman ${spacemanId}: ${message}\n---\n`;
    fs.appendFileSync(this.logFile, logEntry, 'utf8');
  }

  private logMultiplierMessage(spacemanId: number, message: string): void {
    const timestamp = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
    const logEntry = `[${timestamp}] Spaceman ${spacemanId}: ${message}\n---\n`;
    fs.appendFileSync(this.multiplierLogFile, logEntry, 'utf8');
  }

  private async updateWebSocketStatusInDB(spacemanId: number, status: string): Promise<void> {
    try {
      // Usar save() en lugar de update() para que se ejecute el trigger de updated_at
      const spaceman = await this.spacemanRepository.findOne({ where: { id: spacemanId } });
      if (spaceman) {
        spaceman.statusWs = status;
        await this.spacemanRepository.save(spaceman);
        this.logger.log(`Estado WebSocket actualizado en BD para spaceman ${spacemanId}: ${status}`);
      }
    } catch (error) {
      this.logger.error(`Error actualizando estado WebSocket en BD para spaceman ${spacemanId}:`, error);
    }
  }

  private startAutoReconnect(spacemanId: number): void {
    // Limpiar intervalo anterior si existe
    if (this.reconnectIntervals.has(spacemanId)) {
      clearInterval(this.reconnectIntervals.get(spacemanId)!);
    }

    // Reconectar cada 5 minutos (300000 ms)
    const interval = setInterval(async () => {
      this.logger.log(`🔄 Reconexión automática programada (5 min) para Spaceman ID: ${spacemanId}`);
      
      try {
        // Marcar como reconexión para agregar reconnect=true
        this.reconnectingSpaceman.add(spacemanId);
        
        // Cerrar conexiones actuales
        const multiplierConn = this.connections.get(`${spacemanId}_multiplier`);
        const financeConn = this.connections.get(`${spacemanId}_finance`);
        
        if (multiplierConn?.ws) {
          multiplierConn.ws.close(4002, 'Auto reconnect - 5 min');
        }
        if (financeConn?.ws) {
          financeConn.ws.close(4002, 'Auto reconnect - 5 min');
        }
        
        // Esperar un momento y reconectar
        setTimeout(async () => {
          const connection = await this.spacemanRepository.findOne({ where: { id: spacemanId } });
          if (connection) {
            this.logger.log(`🔄 Ejecutando reconexión automática con reconnect=true para Spaceman ID: ${spacemanId}`);
            await this.updateTokenAndConnect(connection);
          }
        }, 2000);
        
      } catch (error) {
        this.logger.error(`❌ Error en reconexión automática para Spaceman ID: ${spacemanId}: ${error.message}`);
      }
    }, 300000); // 5 minutos
    
    this.reconnectIntervals.set(spacemanId, interval);
    this.logger.log(`✅ Reconexión automática cada 5 minutos iniciada para Spaceman ID: ${spacemanId}`);
  }

  private startPing(ws: WebSocket, type: string, spacemanId: number): void {
    const sendPing = () => {
      const now = new Date();
      const seconds = now.getSeconds();
      const millisecondsUntilNextTen = (10 - (seconds % 10)) * 1000 - now.getMilliseconds();
      
      setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          const timestamp = Date.now();
          ws.send(`<ping time='${timestamp}'></ping>`);
          this.logger.debug(`Ping enviado a ${type} Spaceman ${spacemanId}: ${timestamp}`);
          
          // Loggear ping en archivos específicos
          if (type === 'multiplier') {
            this.logMultiplierMessage(spacemanId, `Ping enviado: ${timestamp}`);
          } else if (type === 'finance') {
            this.logFinanceMessage(spacemanId, `<ping time='${timestamp}'></ping>`);
          }
        }
        
        setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            const timestamp = Date.now();
            ws.send(`<ping time='${timestamp}'></ping>`);
            this.logger.debug(`Ping enviado a ${type} Spaceman ${spacemanId}: ${timestamp}`);
            
            // Loggear ping en archivos específicos
            if (type === 'multiplier') {
              this.logMultiplierMessage(spacemanId, `Ping enviado: ${timestamp}`);
            } else if (type === 'finance') {
              this.logFinanceMessage(spacemanId, `<ping time='${timestamp}'></ping>`);
            }
          }
        }, 10000);
      }, millisecondsUntilNextTen);
    };
    sendPing();
  }

  private startTimer(spacemanId: number, gameId: string, initialSeconds: number): void {
    let secondsLeft = initialSeconds;
    const interval = setInterval(() => {
      if (secondsLeft > 0) {
        this.io?.to(`spaceman:${spacemanId}`).emit('timer', {
          gameId,
          message: `PRÓXIMO JUEGO EN ${secondsLeft}s`,
        });
        secondsLeft--;
      } else {
        this.io?.to(`spaceman:${spacemanId}`).emit('timer', {
          gameId,
          message: 'APUESTAS CERRADAS',
        });
        clearInterval(interval);
      }
    }, 1000);
  }

  public setSocketIO(io: any): void {
    this.io = io;
  }

  public getSocketIO(): any {
    return this.io;
  }

  public async resetConnections(io: any): Promise<void> {
    // Log para detectar quien está llamando resetConnections
    const stack = new Error().stack;
    const caller = stack?.split('\n')[2]?.trim() || 'unknown';
    this.logger.warn(`🔄 RESET CONNECTIONS llamado desde: ${caller}`);
    
    // Limpiar intervalos de auto-reconnect
    for (const [spacemanId, interval] of this.reconnectIntervals) {
      clearInterval(interval);
      this.logger.log(`Intervalo de auto-reconnect limpiado para Spaceman ID: ${spacemanId}`);
    }
    this.reconnectIntervals.clear();
    
    // Cerrar todas las conexiones WebSocket existentes
    for (const [key, connection] of this.connections) {
      if (connection.ws && connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.close();
        this.logger.log(`Conexión WebSocket cerrada: ${key}`);
      }
    }
    
    // Limpiar el Map de conexiones
    this.connections.clear();
    
    // Reasignar io y reiniciar conexiones
    this.io = io;
    await this.initializeConnections(io);
    this.logger.log('Conexiones WebSocket reseteadas correctamente');
  }

  public async closeAllConnections(): Promise<void> {
    this.logger.log('Cerrando todas las conexiones WebSocket de Spaceman...');
    
    // Limpiar intervalos de auto-reconnect
    for (const [spacemanId, interval] of this.reconnectIntervals) {
      clearInterval(interval);
      this.logger.log(`Intervalo de auto-reconnect limpiado para Spaceman ID: ${spacemanId}`);
    }
    this.reconnectIntervals.clear();
    
    // Cerrar todas las conexiones WebSocket existentes
    for (const [key, connection] of this.connections) {
      if (connection.ws && connection.ws.readyState === WebSocket.OPEN) {
        connection.ws.close(1000, 'Servicio detenido manualmente');
        this.logger.log(`Conexión WebSocket cerrada: ${key}`);
      }
    }
    
    // Limpiar el Map de conexiones
    this.connections.clear();
    
    // Los timers de ping se limpiarán automáticamente al cerrar las conexiones WebSocket
    
    // Timers de ping se limpian automáticamente al cerrar conexiones
    
    this.logger.log('Todas las conexiones WebSocket de Spaceman cerradas');
  }

  public async initializeConnections(io: any): Promise<void> {
    // Log para detectar quién está llamando initializeConnections
    const stack = new Error().stack;
    const caller = stack?.split('\n')[2]?.trim() || 'unknown';
    this.logger.warn(`🔄 INITIALIZE CONNECTIONS llamado desde: ${caller}`);
    
    // Verificar si ya hay conexiones activas para evitar reinicios innecesarios
    const activeConnections = Array.from(this.connections.values()).filter(
      conn => conn.status === 'CONNECTED' || conn.status === 'CONNECTING'
    );
    
    if (activeConnections.length > 0) {
      this.logger.warn(`⚠️ Ya hay ${activeConnections.length} conexiones activas, saltando reinicialización`);
      this.io = io; // Solo actualizar io
      return;
    }
    
    this.io = io;
    try {
      const spacemanConnections = await this.spacemanRepository.find({
        relations: ['game', 'bookmaker'],
        select: {
          id: true,
          gameId: true,
          bookmakerId: true,
          urlSessionid: true,
          jsessionid: true,
          broadcasterBase: true,
          financeBase: true,
          tokenUpdatedAt: true,
          headers: true,
          bookmaker: {
            id: true,
            isActive: true,
            bookmaker: true
          }
        }
      });

      for (const connection of spacemanConnections) {
        // NO forzar actualización de token - usar el configurado manualmente
        this.setForceTokenUpdate(false);
        await this.updateTokenAndConnect(connection);
      }

      // Sistema de actualización automática eliminado - solo manual vía endpoint
    } catch (error) {
      this.logger.error('Error inicializando conexiones Spaceman:', error.message);
    }
  }

  /**
   * Establecer flag para forzar actualización de tokens en próxima conexión
   */
  public setForceTokenUpdate(force: boolean): void {
    this.forceTokenUpdate = force;
    this.logger.log(`🔄 Forzar actualización de tokens: ${force ? 'ACTIVADO' : 'DESACTIVADO'}`);
  }

  /**
   * Actualizar tokens manualmente vía endpoint (eliminado sistema automático)
   */
  public async updateTokensManually(): Promise<{ success: boolean; message: string; updated: number }> {
    try {
      this.logger.log('Iniciando actualización manual de tokens...');
      
      // Obtener todos los spacemen activos
      const spacemen = await this.spacemanRepository.find({
        where: { urlSessionid: 'IS NOT NULL' as any },
        relations: ['bookmaker']
      });

      let updatedCount = 0;
      
      // Actualizar tokens uno por uno
      for (const spaceman of spacemen) {
        if (spaceman.bookmaker?.isActive) {
          try {
            const success = await this.spacemanTokenService.updateJSessionId(spaceman.id, true);
            if (success) updatedCount++;
          } catch (error) {
            this.logger.error(`Error actualizando token para Spaceman ${spaceman.id}: ${error.message}`);
          }
        }
      }

      return {
        success: true,
        message: `Tokens actualizados exitosamente. ${updatedCount} tokens renovados.`,
        updated: updatedCount
      };
    } catch (error) {
      this.logger.error('Error en actualización manual de tokens:', error.message);
      return {
        success: false,
        message: `Error actualizando tokens: ${error.message}`,
        updated: 0
      };
    }
  }

  /**
   * Conectar solo multiplicador de manera independiente
   */
  public async connectMultiplierOnly(spacemanId: number): Promise<{ success: boolean; message: string }> {
    try {
      const connection = await this.spacemanRepository.findOne({ where: { id: spacemanId } });
      if (!connection) {
        return { success: false, message: 'Spaceman no encontrado' };
      }

      await this.connectToMultiplier(connection);
      this.logger.log(`✅ Multiplicador conectado independientemente para Spaceman ID: ${spacemanId}`);
      return { success: true, message: 'Multiplicador conectado exitosamente' };
    } catch (error) {
      this.logger.error(`❌ Error conectando multiplicador independiente ID: ${spacemanId}: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  /**
   * Conectar solo finanzas de manera independiente
   */
  public async connectFinanceOnly(spacemanId: number): Promise<{ success: boolean; message: string }> {
    try {
      const connection = await this.spacemanRepository.findOne({ where: { id: spacemanId } });
      if (!connection) {
        return { success: false, message: 'Spaceman no encontrado' };
      }

      await this.connectToFinance(connection);
      this.logger.log(`✅ Finanzas conectado independientemente para Spaceman ID: ${spacemanId}`);
      return { success: true, message: 'Finanzas conectado exitosamente' };
    } catch (error) {
      this.logger.error(`❌ Error conectando finanzas independiente ID: ${spacemanId}: ${error.message}`);
      return { success: false, message: error.message };
    }
  }

  /**
   * Actualiza automáticamente el token y conecta los WebSockets
   */
  private async updateTokenAndConnect(connection: Spaceman): Promise<void> {
    try {
      // Log para rastrear qué está llamando este método
      const stack = new Error().stack;
      const caller = stack?.split('\n')[2]?.trim() || 'unknown';
      this.logger.warn(`🔄 updateTokenAndConnect llamado para Spaceman ${connection.id} desde: ${caller}`);
      
      // Verificar si ya se está conectando para evitar duplicados
      if (this.connectingSpaceman.has(connection.id)) {
        this.logger.warn(`Spaceman ${connection.id}: Conexión ya en progreso, saltando`);
        return;
      }

      // Verificar que el bookmaker esté activo antes de proceder
      if (!connection.bookmaker || !connection.bookmaker.isActive) {
        this.logger.warn(`Spaceman ${connection.id}: Bookmaker ${connection.bookmakerId} está inactivo, saltando conexión`);
        return;
      }

      // Marcar como conectando
      this.connectingSpaceman.add(connection.id);
      
      let success = true;
      
      // Solo actualizar tokens si se fuerza explícitamente
      if (this.forceTokenUpdate) {
        this.logger.log(`🔄 FORZANDO actualización de token para Spaceman ${connection.id}...`);
        success = await this.spacemanTokenService.updateJSessionId(connection.id, true);
        this.forceTokenUpdate = false; // Resetear flag después de usar
      } else {
        // Validar que el token existe sin actualizarlo
        this.logger.log(`✅ Usando JSESSIONID configurado manualmente para Spaceman ${connection.id}`);
        success = await this.spacemanTokenService.updateJSessionId(connection.id, false);
      }
      
      if (success) {
        // Obtener la conexión actualizada con el nuevo token
        const updatedConnection = await this.spacemanRepository.findOne({
          where: { id: connection.id },
          relations: ['bookmaker'],
          select: {
            id: true,
            gameId: true,
            bookmakerId: true,
            urlSessionid: true,
            jsessionid: true,
            broadcasterBase: true,
            financeBase: true,
            headers: true,
            bookmaker: {
              id: true,
              isActive: true,
              bookmaker: true
            }
          }
        });

        if (updatedConnection && this.isValidConnection(updatedConnection)) {
          this.logger.log(`Token actualizado exitosamente para Spaceman ${connection.id}, iniciando conexiones...`);
          
          // Conectar a multiplier
          this.connectToMultiplier(updatedConnection);
          
          // Conectar a finance si tiene financeBase
          if (updatedConnection.financeBase) {
            this.connectToFinance(updatedConnection);
          }
        } else {
          this.logger.error(`Conexión no válida después de actualizar token para Spaceman ${connection.id}`);
        }
      } else {
        this.logger.error(`No se pudo actualizar el token para Spaceman ${connection.id}`);
      }
    } catch (error) {
      this.logger.error(`Error actualizando token para Spaceman ${connection.id}: ${error.message}`);
    } finally {
      // Remover del conjunto de conexiones en progreso
      this.connectingSpaceman.delete(connection.id);
    }
  }

  private isValidConnection(connection: Spaceman): boolean {
    const { broadcasterBase, jsessionid, bookmaker } = connection;
    
    // Log de debug para ver qué está pasando
    this.logger.debug(`Spaceman ${connection.id}: Validando conexión - bookmaker existe: ${!!bookmaker}, isActive: ${bookmaker?.isActive}, bookmakerId: ${connection.bookmakerId}`);
    
    // Verificar que el bookmaker esté activo
    if (!bookmaker || !bookmaker.isActive) {
      this.logger.warn(`Spaceman ${connection.id}: Bookmaker ${connection.bookmakerId} está inactivo, saltando conexión`);
      return false;
    }
    
    return !!broadcasterBase && 
           broadcasterBase.startsWith('wss://') && 
           !!jsessionid; // Verificar que tenga JSESSIONID
  }

  private connectToMultiplier(connection: Spaceman): void {
    const { id } = connection;
    // Verificar si es una reconexión por session offline
    const isReconnecting = this.reconnectingSpaceman.has(id);
    const { broadcasterUrl } = this.spacemanTokenService.getWebSocketUrls(connection, isReconnecting);
    
    // Limpiar flag de reconexión después de obtener la URL
    if (isReconnecting) {
      this.reconnectingSpaceman.delete(id);
      this.logger.log(`🔄 Reconectando multiplicador con reconnect=true para Spaceman ID: ${id}`);
    }
    
    // Extraer Host dinámicamente de la URL
    let dynamicHost = 'broadcaster.pragmaticplaylive.net';
    try {
      const urlObj = new URL(broadcasterUrl);
      dynamicHost = urlObj.hostname;
    } catch (error) {
      this.logger.warn(`No se pudo extraer host de URL: ${broadcasterUrl}, usando default`);
    }

    // Usar headers de la BD si existen, sino usar defaults
    const defaultHeaders = {
      Host: dynamicHost,
      Connection: 'Upgrade',
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      Upgrade: 'websocket',
      Origin: 'https://client.pragmaticplaylive.net',
      'Sec-WebSocket-Version': '13',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Accept-Language': 'es-419,es;q=0.9',
      'Sec-GPC': '1',
      'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
      'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
    };

    const headers = connection.headers?.broadcaster 
      ? { 
          ...connection.headers.broadcaster, 
          'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
          Host: dynamicHost // Siempre usar el host dinámico
        }
      : defaultHeaders;

    if (!broadcasterUrl) {
      this.logger.error(`URL WebSocket no válida para Spaceman ID: ${id}`);
      return;
    }
    
    const ws = new WebSocket(broadcasterUrl, { headers });
    this.connections.set(`${id}_multiplier`, { ws, status: 'CONNECTING', retryCount: 0 });

    ws.on('open', () => {
      this.connections.set(`${id}_multiplier`, { ws, status: 'CONNECTED', retryCount: 0 });
      this.startPing(ws, 'multiplier', id);
      this.logger.log(`Conexión multiplicador establecida para Spaceman ID: ${id}`);
      
      // Iniciar reconexión automática cada 5 minutos
      this.startAutoReconnect(id);
      
      // Actualizar estado en la base de datos
      this.updateWebSocketStatusInDB(id, 'CONNECTED');
      
      // Loggear en el archivo de multiplicador
      this.logMultiplierMessage(id, `Conexión multiplicador establecida exitosamente`);
    });

    ws.on('message', async (data: WebSocket.Data) => {
      const message = data.toString();
      try {
        // Verificar mensaje de sesión offline - única reconexión automática permitida
        if (message.includes('<session>offline</session>')) {
          this.logger.warn(`🔄 Sesión offline detectada en multiplicador Spaceman ID: ${id}. Iniciando reconexión única con actualización de token...`);
          
          // Marcar como reconexión para agregar reconnect=true
          this.reconnectingSpaceman.add(id);
          this.logger.log(`🔄 Flag de reconexión marcado para multiplicador Spaceman ID: ${id}`);
          
          // Cerrar con código específico para session offline (4001)
          ws.close(4001, 'Session offline - reconnecting');
          
          // Reconectar una sola vez después de breve delay
          setTimeout(async () => {
            this.logger.log(`🔄 Iniciando reconexión programada para multiplicador Spaceman ID: ${id}...`);
            try {
              const connection = await this.spacemanRepository.findOne({ where: { id } });
              if (connection) {
                // FORZAR actualización de token por session offline
                this.setForceTokenUpdate(true);
                this.logger.log(`🔄 Llamando updateTokenAndConnect para multiplicador Spaceman ID: ${id}...`);
                await this.updateTokenAndConnect(connection);
                this.logger.log(`✅ Reconexión automática completada para multiplicador Spaceman ID: ${id} con token actualizado y reconnect=true`);
              } else {
                this.logger.error(`❌ Spaceman ID: ${id} no encontrado para reconexión automática`);
              }
            } catch (error) {
              this.logger.error(`❌ Error en reconexión automática multiplicador ID: ${id}: ${error.message}`);
            }
          }, 3000);
          return;
        }

        // Procesar mensajes normales de multiplicador
        const match = message.match(/<sm_mul gId="([^"]*)" mul="([^"]*)" seq="([^"]*)"><\/sm_mul>/);
        if (match) {
          const [, gId, mul] = match;
          const multiplier = parseFloat(mul);
          
          // Loggear el multiplicador recibido
          this.logMultiplierMessage(id, `Multiplicador recibido - Game ID: ${gId}, Multiplicador: ${multiplier}x`);
          
          // Emitir al frontend
          this.io?.to(`spaceman:${id}`).emit('liveMultiplier', { 
            gameId: gId, 
            multiplier: multiplier
          });
          
          // Loggear en consola también
          this.logger.log(`🚀 Multiplicador Spaceman ${id}: ${gId} = ${multiplier}x`);
        } else {
          // Loggear otros mensajes del multiplicador para debugging
          if (message.trim() && !message.includes('<ping') && !message.includes('<pong')) {
            this.logMultiplierMessage(id, `Mensaje no procesado: ${message.substring(0, 200)}`);
            this.logger.debug(`📡 Mensaje multiplicador no procesado Spaceman ${id}: ${message.substring(0, 200)}`);
          }
        }
      } catch (error) {
        this.logger.error(`Error procesando mensaje multiplicador Spaceman ID: ${id}: ${error.message}`);
      }
    });

    ws.on('error', (error) => {
      this.logger.error(`Error WebSocket multiplicador para Spaceman ID: ${id}: ${error.message}`);
      this.logMultiplierMessage(id, `Error WebSocket: ${error.message}`);
      
      // Actualizar estado en la base de datos si la conexión está cerrada
      if (ws.readyState === WebSocket.CLOSED) {
        this.updateWebSocketStatusInDB(id, 'DISCONNECTED');
      }
    });



    ws.on('close', (code, reason) => {
      const currentConnection = this.connections.get(`${id}_multiplier`);
      const retryCount = (currentConnection?.retryCount || 0) + 1;
      
      this.logger.warn(`Multiplicador Spaceman ${id} desconectado. Código: ${code}, Razón: ${reason}`);
      this.logMultiplierMessage(id, `Desconectado - Código: ${code}, Razón: ${reason}`);
      
      this.connections.set(`${id}_multiplier`, { 
        ws, 
        status: 'DISCONNECTED', 
        retryCount 
      });
      
      // Actualizar estado en la base de datos
      this.updateWebSocketStatusInDB(id, 'DISCONNECTED');
      
      // Solo reconectar si no fue un cierre normal (código 1000)
      if (code !== 1000 && retryCount < this.maxRetries) {
        this.logger.warn(`Programando reconexión multiplicador Spaceman ID: ${id}, intento ${retryCount}/${this.maxRetries}`);
        
        // Usar delay más largo para evitar spam de reconexiones cuando falla el token
        const delay = retryCount > 1 ? this.retryDelay * 3 : this.retryDelay;
        
        setTimeout(async () => {
          // Verificar si el bookmaker sigue activo antes de reconectar
          const currentConnection = await this.spacemanRepository.findOne({
            where: { id },
            relations: ['bookmaker'],
            select: {
              id: true,
              gameId: true,
              bookmakerId: true,
              urlSessionid: true,
              jsessionid: true,
              broadcasterBase: true,
              financeBase: true,
              tokenUpdatedAt: true,
              headers: true,
              bookmaker: {
                id: true,
                isActive: true,
                bookmaker: true
              }
            }
          });
          
          if (currentConnection?.bookmaker?.isActive) {
            // Actualizar token antes de reconectar
            await this.updateTokenAndConnect(currentConnection);
          } else {
            this.logger.warn(`Spaceman ${id}: Bookmaker inactivo, cancelando reconexión multiplicador`);
          }
        }, delay);
      } else if (code === 1000) {
        this.logger.log(`Multiplicador Spaceman ${id}: Cierre normal, no se reintentará`);
      } else {
        this.logger.error(`Máximo de reintentos alcanzado para multiplicador Spaceman ID: ${id}`);
      }
    });
  }

  private connectToFinance(connection: Spaceman): void {
    const { id } = connection;
    // Verificar si es una reconexión por session offline
    const isReconnecting = this.reconnectingSpaceman.has(id);
    const { financeUrl } = this.spacemanTokenService.getWebSocketUrls(connection, isReconnecting);
    
    // Limpiar flag de reconexión después de obtener la URL
    if (isReconnecting) {
      this.reconnectingSpaceman.delete(id);
      this.logger.log(`🔄 Reconectando finanzas con reconnect=true para Spaceman ID: ${id}`);
    }
    

    if (!financeUrl) {
      this.logger.error(`URL WebSocket de finanzas no válida para Spaceman ID: ${id}`);
      return;
    }

    // Extraer Host dinámicamente de la URL
    let dynamicHost = 'gs12.pragmaticplaylive.net';
    try {
      const urlObj = new URL(financeUrl);
      dynamicHost = urlObj.hostname;
    } catch (error) {
      this.logger.warn(`No se pudo extraer host de URL: ${financeUrl}, usando default`);
    }

    // Usar headers de la BD si existen, sino usar defaults
    const defaultHeaders = {
      Host: dynamicHost,
      Connection: 'Upgrade',
      Pragma: 'no-cache',
      'Cache-Control': 'no-cache',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      Upgrade: 'websocket',
      Origin: 'https://client.pragmaticplaylive.net',
      'Sec-WebSocket-Version': '13',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Accept-Language': 'es-419,es;q=0.9',
      'Sec-GPC': '1',
      'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
      'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
    };

    const headers = connection.headers?.finance 
      ? { 
          ...connection.headers.finance, 
          'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'),
          Host: dynamicHost // Siempre usar el host dinámico
        }
      : defaultHeaders;

    const ws = new WebSocket(financeUrl, { headers });
    this.connections.set(`${id}_finance`, { ws, status: 'CONNECTING', retryCount: 0 });

    ws.on('open', () => {
      this.connections.set(`${id}_finance`, { ws, status: 'CONNECTED', retryCount: 0 });
      this.startPing(ws, 'finance', id);
      this.logger.log(`Conexión finanzas establecida para Spaceman ID: ${id}`);
      this.logger.log(`URL de finanzas conectada: ${financeUrl}`);
      
      // Actualizar estado en la base de datos
      this.updateWebSocketStatusInDB(id, 'CONNECTED');
    });

    ws.on('message', async (data: WebSocket.Data) => {
      try {
        const message = data.toString();
        this.logFinanceMessage(id, message);

        // Verificar mensaje de sesión offline - única reconexión automática permitida
        if (message.includes('<session>offline</session>')) {
          this.logger.warn(`🔄 Sesión offline detectada en finanzas Spaceman ID: ${id}. Iniciando reconexión única con actualización de token...`);
          
          // Marcar como reconexión para agregar reconnect=true
          this.reconnectingSpaceman.add(id);
          this.logger.log(`🔄 Flag de reconexión marcado para finanzas Spaceman ID: ${id}`);
          
          // Cerrar con código específico para session offline (4001)
          ws.close(4001, 'Session offline - reconnecting');
          
          // Reconectar una sola vez después de breve delay
          setTimeout(async () => {
            this.logger.log(`🔄 Iniciando reconexión programada para finanzas Spaceman ID: ${id}...`);
            try {
              const connection = await this.spacemanRepository.findOne({ where: { id } });
              if (connection) {
                // FORZAR actualización de token por session offline
                this.setForceTokenUpdate(true);
                this.logger.log(`🔄 Llamando updateTokenAndConnect para finanzas Spaceman ID: ${id}...`);
                await this.updateTokenAndConnect(connection);
                this.logger.log(`✅ Reconexión automática completada para finanzas Spaceman ID: ${id} con token actualizado y reconnect=true`);
              } else {
                this.logger.error(`❌ Spaceman ID: ${id} no encontrado para reconexión automática`);
              }
            } catch (error) {
              this.logger.error(`❌ Error en reconexión automática finanzas ID: ${id}: ${error.message}`);
            }
          }, 3000);
          return;
        }

        // Timer handling
        const timerMatch = message.match(/<timer id="([^"]*)"[^>]*>(\d+)<\/timer>/);
        if (timerMatch) {
          const [, gameId, seconds] = timerMatch;
          const initialSeconds = parseInt(seconds);
          this.startTimer(id, gameId, initialSeconds);
        }

        // Leaderboard handling
        const lbMatch = message.match(/<sm_lb tba="([^"]*)" gId="([^"]*)" pCount="([^"]*)" tId="([^"]*)" seq="([^"]*)">([\s\S]*?)<\/sm_lb>/);
        if (lbMatch) {
          await this.processLeaderboard(id, lbMatch);
        }

        // Statistics handling
        const statsMatch = message.match(/<SpaceManStatisticHistory seq="([^"]*)">([\s\S]*?)<\/SpaceManStatisticHistory>/);
        if (statsMatch) {
          this.processStatistics(id, statsMatch);
        }

        // Game result handling
        const grMatch = message.match(/<gr result="([^"]*)" gId="([^"]*)" seq="([^"]*)"><\/gr>/);
        if (grMatch) {
          await this.processGameResult(id, grMatch);
        }
      } catch (error) {
        this.logger.error(`Error procesando mensaje WebSocket finanzas para Spaceman ID: ${id}: ${error.message}`);
      }
    });

    ws.on('error', (error) => {
      this.logger.error(`Error WebSocket finanzas para Spaceman ID: ${id}: ${error.message}`);
      this.logger.error(`URL que falló: ${financeUrl}`);
      this.logger.error(`Stack completo: ${error.stack}`);
    });



    ws.on('close', (code, reason) => {
      const currentConnection = this.connections.get(`${id}_finance`);
      const retryCount = (currentConnection?.retryCount || 0) + 1;
      
      this.logger.warn(`Finanzas Spaceman ${id} desconectado. Código: ${code}, Razón: ${reason}`);
      this.logger.warn(`Tiempo de conexión: desde ${new Date().toLocaleTimeString()}`);
      
      this.connections.set(`${id}_finance`, { 
        ws, 
        status: 'DISCONNECTED', 
        retryCount 
      });
      
      // Actualizar estado en la base de datos
      this.updateWebSocketStatusInDB(id, 'DISCONNECTED');
      
      // Solo reconectar si no fue un cierre normal (código 1000)
      if (code !== 1000 && retryCount < this.maxRetries) {
        this.logger.warn(`Programando reconexión finanzas Spaceman ID: ${id}, intento ${retryCount}/${this.maxRetries}`);
        
        // Usar delay más largo para evitar spam de reconexiones cuando falla el token
        const delay = retryCount > 1 ? this.retryDelay * 3 : this.retryDelay;
        
        setTimeout(async () => {
          // Verificar si el bookmaker sigue activo antes de reconectar
          const currentConnection = await this.spacemanRepository.findOne({
            where: { id },
            relations: ['bookmaker'],
            select: {
              id: true,
              gameId: true,
              bookmakerId: true,
              urlSessionid: true,
              jsessionid: true,
              broadcasterBase: true,
              financeBase: true,
              tokenUpdatedAt: true,
              headers: true,
              bookmaker: {
                id: true,
                isActive: true,
                bookmaker: true
              }
            }
          });
          
          if (currentConnection?.bookmaker?.isActive) {
            // Actualizar token antes de reconectar
            await this.updateTokenAndConnect(currentConnection);
          } else {
            this.logger.warn(`Spaceman ${id}: Bookmaker inactivo, cancelando reconexión finanzas`);
          }
        }, delay);
      } else if (code === 1000) {
        this.logger.log(`Finanzas Spaceman ${id}: Cierre normal, no se reintentará`);
      } else {
        this.logger.error(`Máximo de reintentos alcanzado para finanzas Spaceman ID: ${id}`);
      }
    });
  }

  private async processLeaderboard(spacemanId: number, lbMatch: RegExpMatchArray): Promise<void> {
    const [, , gId, pCount, , , users] = lbMatch;
    const onlinePlayer = parseInt(pCount) || 0;

    const allUsers = users.match(/<user[^>]*>/g) || [];
    let totalBetAmount = 0;
    let totalCashout = 0;
    let betsCount = 0;

    allUsers.forEach(user => {
      const cCodeMatch = user.match(/cCode="([^"]*)"/);
      const rTypeMatch = user.match(/rType="([^"]*)"/);
      if (!cCodeMatch || !rTypeMatch) return;

      const cCode = cCodeMatch[1];
      const rType = rTypeMatch[1];

      if (rType === 'B') {
        betsCount++;
        if (cCode === 'COP') {
          const bAmtMatch = user.match(/bAmt="([^"]*)"/);
          totalBetAmount += bAmtMatch ? parseFloat(bAmtMatch[1]) || 0 : 0;
        } else {
          const eBetAmtMatch = user.match(/eBetAmt="([^"]*)"/);
          totalBetAmount += eBetAmtMatch ? (parseFloat(eBetAmtMatch[1]) || 0) * this.exchangeRateEurToCop : 0;
        }
      } else if (rType === 'W') {
        if (cCode === 'COP') {
          const wAmtMatch = user.match(/wAmt="([^"]*)"/);
          totalCashout += wAmtMatch ? parseFloat(wAmtMatch[1]) || 0 : 0;
        } else {
          const eWinAmtMatch = user.match(/eWinAmt="([^"]*)"/);
          totalCashout += eWinAmtMatch ? (parseFloat(eWinAmtMatch[1]) || 0) * this.exchangeRateEurToCop : 0;
        }
      }
    });

    const currentRound = this.roundData.get(spacemanId)?.[gId] || {};
    currentRound.total_bet_amount = (currentRound.total_bet_amount || 0) + totalBetAmount;
    currentRound.online_player = onlinePlayer;
    currentRound.bets_count = (currentRound.bets_count || 0) + betsCount;
    currentRound.total_cashout = (currentRound.total_cashout || 0) + totalCashout;
    currentRound.casino_profit = (currentRound.total_bet_amount || 0) - (currentRound.total_cashout || 0);
    
    this.roundData.set(spacemanId, { 
      ...this.roundData.get(spacemanId) || {}, 
      [gId]: currentRound 
    });

    this.io?.to(`spaceman:${spacemanId}`).emit('round', {
      game_id: gId,
      bets_count: currentRound.bets_count,
      total_bet_amount: currentRound.total_bet_amount,
      online_player: currentRound.online_player,
      total_cashout: currentRound.total_cashout,
      casino_profit: currentRound.casino_profit,
    });
  }

  private processStatistics(spacemanId: number, statsMatch: RegExpMatchArray): void {
    const [, , jsonData] = statsMatch;
    try {
      const stats = JSON.parse(jsonData);
      if (stats.history && Array.isArray(stats.history)) {
        stats.history.forEach((game: any) => {
          const gId = game.gameId;
          const currentRound = this.roundData.get(spacemanId)?.[gId] || {};
          currentRound.bets_count = parseInt(game.betCount) || currentRound.bets_count || 0;
          currentRound.online_player = parseInt(game.playerCount) || currentRound.online_player || 0;
          this.roundData.set(spacemanId, { 
            ...this.roundData.get(spacemanId) || {}, 
            [gId]: currentRound 
          });
        });
      }
    } catch (error) {
      this.logger.error(`Error parseando SpaceManStatisticHistory para Spaceman ID: ${spacemanId}: ${error.message}`);
    }
  }

  private async processGameResult(spacemanId: number, grMatch: RegExpMatchArray): Promise<void> {
    const [, result, gId] = grMatch;
    const maxMultiplier = parseFloat(result) || 0;

    const currentRound = this.roundData.get(spacemanId)?.[gId] || {};
    const round: GameRound = {
      game_id: gId,
      bets_count: currentRound.bets_count || 0,
      total_bet_amount: currentRound.total_bet_amount || 0,
      online_player: currentRound.online_player || 0,
      max_multiplier: maxMultiplier,
      total_cashout: currentRound.total_cashout || 0,
      casino_profit: (currentRound.total_bet_amount || 0) - (currentRound.total_cashout || 0),
    };

    await this.saveRound(spacemanId, round);

    // Reset round data
    this.roundData.set(spacemanId, {
      ...this.roundData.get(spacemanId) || {},
      [gId]: {
        total_bet_amount: 0,
        bets_count: 0,
        total_cashout: 0,
        online_player: 0,
        casino_profit: 0,
      },
    });

    this.io?.to(`spaceman:${spacemanId}`).emit('round', {
      game_id: gId,
      bets_count: 0,
      total_bet_amount: 0,
      online_player: 0,
      total_cashout: 0,
      casino_profit: 0,
    });
  }

  private async saveRound(spacemanId: number, round: GameRound): Promise<SpacemanRound | null> {
    try {
      const spacemanRound = await this.spacemanRoundRepository.save({
        game_id: round.game_id,
        bets_count: round.bets_count || null,
        total_bet_amount: round.total_bet_amount || null,
        online_player: round.online_player || null,
        max_multiplier: round.max_multiplier || null,
        total_cashout: round.total_cashout || null,
        casino_profit: round.casino_profit || null,
        spaceman_id: spacemanId,
      });

      this.logger.log(`Ronda guardada para Spaceman ${spacemanId}: ${round.game_id}`);
      
      // Emitir ronda guardada con TODOS los datos para que el frontend actualice TODO
      this.io?.to(`spaceman:${spacemanId}`).emit('round', {
        game_id: spacemanRound.game_id,
        max_multiplier: spacemanRound.max_multiplier,
        bets_count: spacemanRound.bets_count,
        total_bet_amount: spacemanRound.total_bet_amount,
        online_player: spacemanRound.online_player,
        total_cashout: spacemanRound.total_cashout,
        casino_profit: spacemanRound.casino_profit,
        game_state: 'End',
      });
      
      // Trigger prediction
      await this.triggerPrediction(spacemanId);
      
      return spacemanRound;
    } catch (error) {
      this.logger.error(`Error guardando ronda para Spaceman ${spacemanId}: ${error.message}`);
      return null;
    }
  }

  private async triggerPrediction(spacemanId: number): Promise<void> {
    if (this.predictionInFlight.has(spacemanId)) return;
    this.predictionInFlight.add(spacemanId);
    try {
      const rounds = await this.spacemanRoundRepository.find({
        order: { created_at: 'DESC' },
        take: 1000,
      });

      if (rounds.length < 1000) {
        this.logger.log(`No hay suficientes rondas (${rounds.length}/1000) para predecir en Spaceman ${spacemanId}`);
        return;
      }

      const formattedRounds = rounds.map(round => ({
        id: round.id,
        timestamp: round.created_at,
        total_bet_amount: parseFloat(round.total_bet_amount?.toString() || '0') || 0,
        total_cashout: parseFloat(round.total_cashout?.toString() || '0') || 0,
        casino_profit: parseFloat(round.casino_profit?.toString() || '0') || 0,
        max_multiplier: parseFloat(round.max_multiplier?.toString() || '0') || 0,
        online_player: parseInt(round.online_player?.toString() || '0') || 0,
        bets_count: parseInt(round.bets_count?.toString() || '0') || 0,
        game_id: round.game_id,
      }));

      const prediction = await this.predictorService.predictSpaceman(formattedRounds as any, spacemanId);
      this.logger.log(`Predicción generada para Spaceman ${spacemanId}: ${JSON.stringify(prediction)}`);
      this.io?.to(`spaceman:${spacemanId}`).emit('prediction', prediction);
    } catch (error: any) {
      this.logger.error('Error al generar predicción para Spaceman:', error.message || error);
    } finally {
      this.predictionInFlight.delete(spacemanId);
    }
  }

  public getRetryCount(spacemanId: number, type: 'multiplier' | 'finance'): number {
    const key = `${spacemanId}_${type}`;
    const connection = this.connections.get(key) || { retryCount: 0 };
    return connection.retryCount || 0;
  }

  public getConnectionStatus(spacemanId: number, type: 'multiplier' | 'finance'): string {
    const key = `${spacemanId}_${type}`;
    const connection = this.connections.get(key);
    return connection?.status || 'DISCONNECTED';
  }

  public getAllConnectionsStatus(): Record<string, any> {
    const status: Record<string, any> = {};
    for (const [key, connection] of this.connections) {
      status[key] = {
        status: connection.status,
        retryCount: connection.retryCount,
      };
    }
    return status;
  }
}
