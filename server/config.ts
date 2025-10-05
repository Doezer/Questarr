import { config } from 'dotenv';
import { join } from 'path';

// Charge le fichier .env en développement
if (process.env.NODE_ENV === 'development') {
  config({ path: join(process.cwd(), '.env') });
}

export const SERVER_CONFIG = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || 'localhost'
};

export const TWITCH_CONFIG = {
  clientId: process.env.TWITCH_CLIENT_ID,
  clientSecret: process.env.TWITCH_CLIENT_SECRET,
};

// Valide la configuration
if (!TWITCH_CONFIG.clientId || !TWITCH_CONFIG.clientSecret) {
  throw new Error(
    'Les variables d\'environnement TWITCH_CLIENT_ID et TWITCH_CLIENT_SECRET sont requises. ' +
    'Veuillez créer un fichier .env à partir du fichier .env.example et remplir les valeurs nécessaires.'
  );
}
