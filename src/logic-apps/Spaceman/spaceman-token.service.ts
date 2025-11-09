import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Spaceman } from '../../entities/spaceman.entity';

@Injectable()
export class SpacemanTokenService {
  private readonly logger = new Logger(SpacemanTokenService.name);

  constructor(
    @InjectRepository(Spaceman)
    private spacemanRepository: Repository<Spaceman>,
  ) {}

  /**
   * Valida que el JSESSIONID esté configurado en la base de datos
   * El administrador debe ingresar el JSESSIONID manualmente
   */
  async updateJSessionId(spacemanId: number, forceUpdate: boolean = false): Promise<boolean> {
    try {
      const spaceman = await this.spacemanRepository.findOne({ where: { id: spacemanId } });

      if (!spaceman) {
        this.logger.error(`Spaceman ${spacemanId} no encontrado`);
        return false;
      }

      // Verificar que tenga JSESSIONID configurado
      if (!spaceman.jsessionid) {
        this.logger.error(`Spaceman ${spacemanId} no tiene JSESSIONID configurado. Por favor, configúralo manualmente en la base de datos.`);
        return false;
      }

      // Actualizar timestamp
      this.logger.log(`Spaceman ${spacemanId} usando JSESSIONID configurado manualmente`);
      await this.spacemanRepository.update(spacemanId, { tokenUpdatedAt: new Date() });
      return true;
    } catch (error: any) {
      this.logger.error(`Error validando JSESSIONID para Spaceman ${spacemanId}: ${error.message}`);
      return false;
    }
  }

  getWebSocketUrls(spaceman: Spaceman, reconnect: boolean = false): { broadcasterUrl: string; financeUrl: string } {
    const jsessionFragment = spaceman.jsessionid || '';
    
    // Si es reconexión, agregar parámetro reconnect=true al inicio
    const reconnectParam = reconnect ? 'reconnect=true&' : '';
    
    // Insertar reconnect=true después del ? y antes de bcs=true
    const broadcasterUrl = spaceman.broadcasterBase + jsessionFragment;
    const financeUrl = spaceman.financeBase + jsessionFragment;
    
    if (reconnect) {
      return {
        broadcasterUrl: broadcasterUrl.replace('?bcs=true&', `?${reconnectParam}bcs=true&`).replace('?', `?${reconnectParam}`),
        financeUrl: financeUrl.replace('?bcs=true&', `?${reconnectParam}bcs=true&`).replace('?', `?${reconnectParam}`)
      };
    }
    
    return {
      broadcasterUrl,
      financeUrl,
    };
  }

  async updateAllJSessionIds(): Promise<void> {
    try {
      const spacemanRecords = await this.spacemanRepository.find({
        where: { urlSessionid: 'IS NOT NULL' as any },
      });

      this.logger.log(`Actualizando JSESSIONID para ${spacemanRecords.length} registros (proxy CO)...`);

      for (const spaceman of spacemanRecords) {
        await this.updateJSessionId(spaceman.id, true);
        await new Promise((r) => setTimeout(r, 1000));
      }

      this.logger.log('Actualización de JSESSIONID completada.');
    } catch (error: any) {
      this.logger.error(`Error actualizando todos los JSESSIONID: ${error.message}`);
    }
  }
}
