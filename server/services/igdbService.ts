import fetch from 'node-fetch';
import { TWITCH_CONFIG } from '../config';

interface IGDBGame {
  id: number;
  name: string;
  summary?: string;
  rating?: number;
  aggregated_rating?: number;
  first_release_date?: number;
  genres?: Array<{ id: number; name: string }>;
  platforms?: Array<{ id: number; name: string; abbreviation?: string }>;
  cover?: { id: number; url: string };
  screenshots?: Array<{ id: number; url: string }>;
}

interface IGDBAuthResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

class IGDBService {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private readonly clientId: string;
  private readonly clientSecret: string;

  constructor() {
    const { clientId, clientSecret } = TWITCH_CONFIG;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  private async authenticate(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const response = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'client_credentials',
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to authenticate with Twitch: ${response.statusText}`);
    }

    const data = await response.json() as IGDBAuthResponse;
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // Refresh 1 minute before expiry

    return this.accessToken;
  }

  private async makeRequest(endpoint: string, query: string): Promise<any> {
    try {
      console.log(`Making IGDB request to endpoint: ${endpoint}`);
      const token = await this.authenticate();
      console.log(`Authentication successful, token obtained`);

      console.log(`Sending query to IGDB: ${query.trim()}`);
      const response = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
        method: 'POST',
        headers: {
          'Client-ID': this.clientId,
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
          'Content-Type': 'text/plain',
        },
        body: query,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`IGDB API error: ${response.status} ${response.statusText}`, errorText);
        throw new Error(`IGDB API error: ${response.statusText}`);
      }

      const result = await response.json();
      console.log(`IGDB API response: ${JSON.stringify(result, null, 2)}`);
      return result;
    } catch (error) {
      console.error('Error in makeRequest:', error);
      throw error;
    }
  }

  private mapPlatformName(platformName: string): string {
    const platformMap: Record<string, string> = {
      'PC (Microsoft Windows)': 'PC',
      'PlayStation 5': 'PlayStation',
      'PlayStation 4': 'PlayStation', 
      'Xbox Series X|S': 'Xbox',
      'Xbox One': 'Xbox',
      'Nintendo Switch': 'Switch',
      'iOS': 'Mobile',
      'Android': 'Mobile',
      'PlayStation VR': 'VR',
      'PlayStation VR2': 'VR',
      'Meta Quest 2': 'VR',
      'SteamVR': 'VR',
    };
    
    return platformMap[platformName] || platformName;
  }

  private formatImageUrl(url: string | undefined, size: string = 'cover_big'): string {
    if (!url) return '/api/placeholder/300/400';
    
    // IGDB returns URLs without protocol and size
    // Format: //images.igdb.com/igdb/image/upload/t_thumb/[id].jpg
    const baseUrl = url.replace('t_thumb', `t_${size}`);
    return `https:${baseUrl}`;
  }

  public async searchGames(query: string, limit: number = 20): Promise<any[]> {
    // Use the search operator which is the recommended approach for text search in IGDB
    const igdbQuery = `
      search "${query}";
      fields name, summary, rating, aggregated_rating, first_release_date, 
             genres.name, platforms.name, cover.url, screenshots.url;
      limit ${limit};
      where category = 0;
    `;

    console.log(`IGDB Search Query v2: ${igdbQuery}`);
    const games = await this.makeRequest('games', igdbQuery) as IGDBGame[];
    console.log(`IGDB Search Results for "${query}":`, games.length, 'games found');
    
    return games.map(game => this.transformGame(game));
  }

  public async getPopularGames(limit: number = 20): Promise<any[]> {
    const igdbQuery = `
      fields name, summary, rating, aggregated_rating, first_release_date,
             genres.name, platforms.name, cover.url, screenshots.url;
      limit ${limit};
      sort rating desc;
      where rating > 75 & version_parent = null & category = 0;
    `;

    const games = await this.makeRequest('games', igdbQuery) as IGDBGame[];
    
    return games.map(game => this.transformGame(game));
  }

  public async getRecentGames(limit: number = 20): Promise<any[]> {
    const oneYearAgo = Math.floor((Date.now() - (365 * 24 * 60 * 60 * 1000)) / 1000);
    
    const igdbQuery = `
      fields name, summary, rating, aggregated_rating, first_release_date,
             genres.name, platforms.name, cover.url, screenshots.url;
      limit ${limit};
      sort first_release_date desc;
      where first_release_date > ${oneYearAgo} & version_parent = null & category = 0;
    `;

    const games = await this.makeRequest('games', igdbQuery) as IGDBGame[];
    
    return games.map(game => this.transformGame(game));
  }

  public async getUpcomingGames(limit: number = 20): Promise<any[]> {
    const now = Math.floor(Date.now() / 1000);
    
    const igdbQuery = `
      fields name, summary, rating, aggregated_rating, first_release_date,
             genres.name, platforms.name, cover.url, screenshots.url;
      limit ${limit};
      sort first_release_date asc;
      where first_release_date > ${now} & version_parent = null & category = 0;
    `;

    const games = await this.makeRequest('games', igdbQuery) as IGDBGame[];
    
    return games.map(game => this.transformGame(game));
  }

  private transformGame(game: IGDBGame): any {
    return {
      externalId: `igdb_${game.id}`,
      title: game.name,
      description: game.summary || '',
      genre: game.genres?.[0]?.name || 'Unknown',
      coverImage: this.formatImageUrl(game.cover?.url),
      releaseDate: game.first_release_date 
        ? new Date(game.first_release_date * 1000).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0],
      rating: game.rating ? (game.rating / 10).toFixed(1) : 
              game.aggregated_rating ? (game.aggregated_rating / 10).toFixed(1) : '0',
      platforms: game.platforms?.map(p => this.mapPlatformName(p.name)) || ['PC'],
      status: 'wishlist', // Default status when adding from discovery
    };
  }
}

export const igdbService = new IGDBService();