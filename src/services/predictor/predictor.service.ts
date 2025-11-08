import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';

export interface RoundDto {
  id?: number;
  roulette_id?: number;
  bookmaker_id?: number;
  round_id?: string;
  game_id?: string;
  number?: number;
  color?: string;
  dozen?: string;
  column?: string;
  timestamp?: string;
  total_bet_amount?: number;
  total_cashout?: number;
  casino_profit?: number;
  max_multiplier?: number;
  online_players?: number;
  online_player?: number;
  bets_count?: number;
}

export interface AviatorPredictionResponse {
  prediction: number;
  score: number;
  apostar: 'SÍ' | 'NO' | string;
  round_id: string | number | null;
}

export interface SpacemanPredictionResponse {
  prediction: number;
  score: number;
  apostar: 'SÍ' | 'NO' | string;
  game_id: string | number | null;
}

export interface RoulettePredictionResponse {
  prediction_type: 'dozen' | 'column';
  predicted_values: string[];
  probability: number; // 0..100
  round_id: string | number | null;
}

@Injectable()
export class PredictorService {
  private readonly logger = new Logger(PredictorService.name);
  private readonly baseUrl: string;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.baseUrl = this.config.get<string>('PREDICTOR_API_URL') || 'http://localhost:8005';
  }

  async health(): Promise<{ status: string }> {
    const url = `${this.baseUrl}/health`;
    const { data } = await firstValueFrom(this.http.get<{ status: string }>(url));
    return data;
  }

  async predictAviator(rounds: RoundDto[], bookmakerId: number): Promise<AviatorPredictionResponse> {
    const url = `${this.baseUrl}/predict`;
    try {
      const payload = { rounds, bookmaker_id: bookmakerId };
      const { data } = await firstValueFrom(this.http.post<AviatorPredictionResponse>(url, payload));
      return data as AviatorPredictionResponse;
    } catch (err) {
      this.logger.error(`Aviator prediction failed: ${err?.message || err}`);
      throw err;
    }
  }

  async predictSpaceman(rounds: RoundDto[], bookmakerId: number): Promise<SpacemanPredictionResponse> {
    const url = `${this.baseUrl}/spaceman/predict/${bookmakerId}`;
    try {
      const payload = { rounds };
      const { data } = await firstValueFrom(this.http.post<any>(url, payload));
      // Normalizar: si viene round_id desde FastAPI, mapearlo a game_id para compatibilidad
      const normalized: SpacemanPredictionResponse = {
        prediction: data?.prediction,
        score: data?.score,
        apostar: data?.apostar,
        game_id: data?.game_id ?? data?.round_id ?? null,
      };
      return normalized;
    } catch (err) {
      this.logger.error(`Spaceman prediction failed: ${err?.message || err}`);
      throw err;
    }
  }

  async predictRoulette(rounds: RoundDto[], rouletteId: number): Promise<RoulettePredictionResponse> {
    const url = `${this.baseUrl}/roulette/predict/${rouletteId}`;
    try {
      const payload = { rounds };
      const { data } = await firstValueFrom(this.http.post<RoulettePredictionResponse>(url, payload));
      return data as RoulettePredictionResponse;
    } catch (err) {
      this.logger.error(`Roulette prediction failed: ${err?.message || err}`);
      throw err;
    }
  }
}
