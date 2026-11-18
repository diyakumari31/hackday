import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const isProd = process.env.NODE_ENV === 'production';

function resolveHmacSecret(): string {
  const configured = process.env.BASITNA_HMAC_SECRET?.trim() ?? '';
  if (isProd) {
    if (configured.length < 32) {
      throw new Error(
        'BASITNA_HMAC_SECRET must be set to at least 32 characters in production.'
      );
    }
    return configured;
  }
  if (configured.length >= 32) {
    return configured;
  }
  return crypto.randomBytes(48).toString('hex');
}

export interface AppConfig {
  port: number;
  nodeEnv: string;
  isProduction: boolean;
  demoMode: boolean;
  hmacSecret: string;
  databaseUrl: string;
  pgSsl: boolean;
  adminApiKey: string;
  geminiApiKey: string;
  geminiModel: string;
}

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  cachedConfig = {
    port: Number(process.env.PORT) || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    isProduction: isProd,
    demoMode: !isProd && process.env.DEMO_MODE !== 'false',
    hmacSecret: resolveHmacSecret(),
    databaseUrl: process.env.DATABASE_URL?.trim() || '',
    pgSsl: process.env.PGSSL === 'true',
    adminApiKey: process.env.ADMIN_API_KEY?.trim() || '',
    geminiApiKey: process.env.GEMINI_API_KEY?.trim() || '',
    geminiModel: process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash',
  };

  return cachedConfig;
}

export function resetConfigForTests(): void {
  cachedConfig = null;
}
