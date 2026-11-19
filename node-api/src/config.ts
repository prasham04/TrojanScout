export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? '',
  orsApiKey: process.env.ORS_API_KEY ?? '',
  aiServiceUrl: process.env.AI_SERVICE_URL ?? 'http://localhost:8000',
  internalKey: process.env.INTERNAL_KEY ?? 'change-me',
  corsOrigin: (process.env.CORS_ORIGIN ?? 'http://localhost:5173').split(','),
}
