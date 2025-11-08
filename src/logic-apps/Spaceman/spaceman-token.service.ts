import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios, { AxiosRequestConfig } from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { Spaceman } from '../../entities/spaceman.entity';

@Injectable()
export class SpacemanTokenService {
  private readonly logger = new Logger(SpacemanTokenService.name);

  constructor(
    @InjectRepository(Spaceman)
    private spacemanRepository: Repository<Spaceman>,
  ) {}

  /**
   * Descarga proxys colombianos usando ScraperAPI
   */
  private async getColombianHttpProxies(): Promise<string[]> {
    try {
      const apiKey = '39027e847bca6bad857e56f93315eacd';
      const targetUrl = 'https://api.proxyscrape.com/v4/free-proxy-list/get?request=displayproxies&protocol=http&timeout=10000&country=CO&ssl=all&anonymity=all&skip=0&limit=2000';
      
      const scraperUrl = `http://api.scraperapi.com/?api_key=${apiKey}&url=${encodeURIComponent(targetUrl)}&render=true&country_code=co`;
      
      this.logger.log(`Haciendo request a ScraperAPI para obtener proxies colombianos...`);
      
      const response = await axios.get(scraperUrl, { 
        timeout: 30000 // Timeout más alto para ScraperAPI
      });

      this.logger.log(`Status: ${response.status}`);
      this.logger.log(`Data type: ${typeof response.data}`);
      this.logger.log(`Data length: ${response.data?.length || 'undefined'}`);
      
      // Procesar la respuesta para separar cada proxy
      if (response.data && typeof response.data === 'string') {
        const proxies = response.data
          .split(/\s+/) // Separar por espacios, saltos de línea, etc.
          .map(proxy => proxy.trim())
          .filter(proxy => proxy && proxy.includes(':'))
          .map(proxy => `http://${proxy}`);
        
        this.logger.log(`Proxies procesados: ${proxies.length}`);
        this.logger.log(`Primeros 5 proxies: ${proxies.slice(0, 5)}`);
        
        return proxies;
      }
      
      this.logger.warn('No se obtuvieron proxies válidos de ScraperAPI');
      return [];

    } catch (err: any) {
      this.logger.error(`Error descargando proxies vía ScraperAPI: ${err.message}`);
      this.logger.error(`Error completo: ${JSON.stringify(err)}`);
      return [];
    }
  }

  /**
   * Realiza una petición GET con axios a través de un proxy HTTP (para HTTPS usamos CONNECT).
   * No sigue redirecciones automáticamente (maxRedirects: 0) para poder leer el header Location.
   */
  private async axiosGetViaProxy(
    targetUrl: string,
    proxyUrl: string,
    headers?: Record<string, string>,
  ) {
    const agent = new HttpsProxyAgent(proxyUrl);

    const cfg: AxiosRequestConfig = {
      url: targetUrl,
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'es-419,es;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        Connection: 'keep-alive',
        ...(headers ?? {}),
      },
      // Importante para proxies en axios:
      proxy: false,                 // desactiva proxy nativo de axios
      httpsAgent: agent,            // túnel para HTTPS
      httpAgent: agent,             // por si el destino fuera HTTP
      maxRedirects: 0,              // NO seguir redirecciones automáticamente
      validateStatus: () => true,   // queremos leer headers aunque sea 3xx
      timeout: 10000,
      responseType: 'text',
    };

    return axios.request(cfg);
  }

  /**
   * Intenta extraer el fragmento JSESSIONID a través de proxys colombianos.
   * Recorre proxys hasta lograr obtener el patrón esperado desde la segunda redirección.
   */
  private async extractJSessionId(urlSessionId: string): Promise<string | null> {
    const proxies = await this.getColombianHttpProxies();

    if (proxies.length === 0) {
      this.logger.warn('No hay proxys colombianos disponibles. (Puedes implementar fallback directo si lo deseas)');
      return null;
    }

    // Cabeceras consistentes
    const commonHeaders = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language': 'es-419,es;q=0.9',
    };

    for (const proxy of proxies) {
      try {
        this.logger.debug(`Intentando extracción vía proxy CO: ${proxy}`);

        // 1) Primera solicitud (esperamos 30x con Location)
        const res1 = await this.axiosGetViaProxy(urlSessionId, proxy, commonHeaders);
        const firstLocation = res1.headers?.location as string | undefined;

        if (!firstLocation) {
          this.logger.debug(`(Proxy ${proxy}) No hubo Location en la primera respuesta. status=${res1.status}`);
          continue; // probamos siguiente proxy
        }

        // 2) Segunda solicitud a la URL de Location (otra 30x con Location)
        const res2 = await this.axiosGetViaProxy(firstLocation, proxy, commonHeaders);
        const secondLocation = res2.headers?.location as string | undefined;

        if (!secondLocation) {
          this.logger.debug(`(Proxy ${proxy}) No hubo Location en la segunda respuesta. status=${res2.status}`);
          continue;
        }

        // 3) Extraer patrón completo JSESSIONID=...&table_id=...
        const match = secondLocation.match(/JSESSIONID=[^&]+&table_id=[^&]+/);
        if (!match) {
          this.logger.debug(`(Proxy ${proxy}) No se encontró el patrón JSESSIONID en la segunda Location.`);
          continue;
        }

        // 4) Transformaciones requeridas
        let transformedToken = match[0]
          .replace(/!/g, '%21')           // ! → %21
          .replace('table_id=', 'tableId=');

        if (!transformedToken.endsWith('nh')) {
          transformedToken += 'nh';
        }

        this.logger.log(`Fragmento JSESSIONID original: ${match[0]}`);
        this.logger.log(`Fragmento JSESSIONID transformado: ${transformedToken}`);

        return transformedToken;
      } catch (err: any) {
        this.logger.debug(`(Proxy ${proxy}) Error intentando extraer JSESSIONID: ${err.message}`);
        // sigue con el siguiente proxy
      }
    }

    this.logger.warn('No se pudo extraer el JSESSIONID con los proxys CO disponibles.');
    return null;
  }

  /**
   * Actualiza el JSESSIONID de un registro de Spaceman (usando proxy CO)
   */
  async updateJSessionId(spacemanId: number, forceUpdate: boolean = false): Promise<boolean> {
    try {
      const spaceman = await this.spacemanRepository.findOne({ where: { id: spacemanId } });

      if (!spaceman || !spaceman.urlSessionid) {
        this.logger.error(`Spaceman ${spacemanId} no encontrado o sin urlSessionid`);
        return false;
      }

      this.logger.log(`Extrayendo JSESSIONID para Spaceman ${spacemanId} vía proxy CO...`);
      const jsessionFragment = await this.extractJSessionId(spaceman.urlSessionid);

      if (jsessionFragment) {
        await this.spacemanRepository.update(spacemanId, {
          jsessionid: jsessionFragment,
          tokenUpdatedAt: new Date(),
        });
        this.logger.log(`JSESSIONID actualizado para Spaceman ${spacemanId}: ${jsessionFragment}`);
        return true;
      } else {
        this.logger.error(`No se pudo extraer JSESSIONID para Spaceman ${spacemanId}`);
        await this.spacemanRepository.update(spacemanId, { tokenUpdatedAt: new Date() });
        this.logger.warn(`Timestamp actualizado para Spaceman ${spacemanId} (fallo de extracción).`);
        return false;
      }
    } catch (error: any) {
      this.logger.error(`Error actualizando JSESSIONID para Spaceman ${spacemanId}: ${error.message}`);
      return false;
    }
  }

  getWebSocketUrls(spaceman: Spaceman): { broadcasterUrl: string; financeUrl: string } {
    const jsessionFragment = spaceman.jsessionid || '';
    return {
      broadcasterUrl: `${spaceman.broadcasterBase}${jsessionFragment}`,
      financeUrl: `${spaceman.financeBase}${jsessionFragment}`,
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
