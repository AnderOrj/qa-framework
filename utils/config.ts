import dotenv from 'dotenv';

dotenv.config();

export const config = {
  baseUrl: process.env.BASE_URL || 'https://example.com',
  apiBaseUrl: process.env.API_BASE_URL || 'https://api.example.com',
  apiToken: process.env.API_TOKEN || '',
  environment: process.env.ENVIRONMENT || 'qa',
  headless: process.env.HEADLESS !== 'false',
};
