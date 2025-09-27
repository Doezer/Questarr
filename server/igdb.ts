interface IGDBGame {
  id: number;
  name: string;
  summary?: string;
  cover?: {
    id: number;
    url: string;
  };
  first_release_date?: number;
  rating?: number;
  platforms?: Array<{
    id: number;
    name: string;
  }>;
  genres?: Array<{
    id: number;
    name: string;
  }>;
  screenshots?: Array<{
    id: number;
    url: string;
  }>;
}

interface IGDBAuthResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

class IGDBClient {
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  private async authenticate(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const clientId = process.env.IGDB_CLIENT_ID;
    const clientSecret = process.env.IGDB_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new Error('IGDB credentials not configured');
    }

    const response = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error(`IGDB authentication failed: ${response.status}`);
    }

    const data: IGDBAuthResponse = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // Refresh 1 minute early

    return this.accessToken;
  }

  private async makeRequest(endpoint: string, query: string): Promise<any> {
    const token = await this.authenticate();
    const clientId = process.env.IGDB_CLIENT_ID;

    const response = await fetch(`https://api.igdb.com/v4/${endpoint}`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Client-ID': clientId!,
        'Authorization': `Bearer ${token}`,
      },
      body: query,
    });

    if (!response.ok) {
      throw new Error(`IGDB API error: ${response.status}`);
    }

    return response.json();
  }

  async searchGames(query: string, limit: number = 20): Promise<IGDBGame[]> {
    // Try multiple search approaches to maximize results
    const searchApproaches = [
      // Approach 1: Full text search without category filter  
      `search "${query}"; fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url; limit ${limit};`,
      
      // Approach 2: Full text search with category filter
      `search "${query}"; fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url; where category = 0; limit ${limit};`,
      
      // Approach 3: Case-insensitive name matching without category
      `fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url; where name ~= "${query}"; limit ${limit};`,
      
      // Approach 4: Partial name matching without category
      `fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url; where name ~ *"${query}"*; sort rating desc; limit ${limit};`
    ];

    for (let i = 0; i < searchApproaches.length; i++) {
      try {
        console.log(`IGDB trying approach ${i + 1} for "${query}"`);
        const results = await this.makeRequest('games', searchApproaches[i]);
        if (results.length > 0) {
          console.log(`IGDB search approach ${i + 1} found ${results.length} results for "${query}"`);
          return results;
        }
      } catch (error) {
        console.warn(`IGDB search approach ${i + 1} failed for "${query}":`, error);
      }
    }

    // If no full-phrase results, try individual words without category filter
    const words = query.toLowerCase().split(' ').filter(word => word.length > 2);
    for (const word of words) {
      try {
        console.log(`IGDB trying word search for: "${word}"`);
        const wordQuery = `fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url; where name ~ *"${word}"*; sort rating desc; limit ${limit};`;
        const wordResults = await this.makeRequest('games', wordQuery);
        
        if (wordResults.length > 0) {
          console.log(`IGDB word search for "${word}" found ${wordResults.length} results`);
          
          // Filter to prefer games containing multiple query words
          const filteredResults = wordResults.filter((game: IGDBGame) => 
            words.filter(w => game.name.toLowerCase().includes(w)).length >= Math.min(2, words.length)
          );
          
          return filteredResults.length > 0 ? filteredResults : wordResults.slice(0, limit);
        }
      } catch (error) {
        console.warn(`IGDB word search failed for "${word}":`, error);
      }
    }

    console.log(`IGDB search found no results for "${query}"`);
    return [];
  }

  async getGameById(id: number): Promise<IGDBGame | null> {
    const igdbQuery = `
      fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url;
      where id = ${id};
    `;

    const results = await this.makeRequest('games', igdbQuery);
    return results.length > 0 ? results[0] : null;
  }

  async getPopularGames(limit: number = 20): Promise<IGDBGame[]> {
    const igdbQuery = `
      fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url;
      where rating > 80 & rating_count > 10;
      sort rating desc;
      limit ${limit};
    `;

    return this.makeRequest('games', igdbQuery);
  }

  async getRecentReleases(limit: number = 20): Promise<IGDBGame[]> {
    const thirtyDaysAgo = Math.floor((Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000);
    const now = Math.floor(Date.now() / 1000);

    const igdbQuery = `
      fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url;
      where first_release_date >= ${thirtyDaysAgo} & first_release_date <= ${now};
      sort first_release_date desc;
      limit ${limit};
    `;

    return this.makeRequest('games', igdbQuery);
  }

  async getUpcomingReleases(limit: number = 20): Promise<IGDBGame[]> {
    const now = Math.floor(Date.now() / 1000);
    const sixMonthsFromNow = Math.floor((Date.now() + 6 * 30 * 24 * 60 * 60 * 1000) / 1000);

    const igdbQuery = `
      fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url;
      where first_release_date >= ${now} & first_release_date <= ${sixMonthsFromNow};
      sort first_release_date asc;
      limit ${limit};
    `;

    return this.makeRequest('games', igdbQuery);
  }

  async getGamesByGenres(genres: string[], excludeIds: number[] = [], limit: number = 20): Promise<IGDBGame[]> {
    if (genres.length === 0) return [];

    // Convert genre names to a query format - use regex matching for better results
    const genreConditions = genres.slice(0, 3).map(genre => {
      // Handle special characters in genre names
      const cleanGenre = genre.replace(/[()]/g, '').replace(/\s+/g, ' ').trim();
      return `genres.name ~ *"${cleanGenre}"*`;
    });
    const genreCondition = genreConditions.join(' | ');
    const excludeCondition = excludeIds.length > 0 ? ` & id != (${excludeIds.join(',')})` : '';

    const igdbQuery = `
      fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url;
      where (${genreCondition}) & rating > 70 & rating_count > 5${excludeCondition};
      sort rating desc;
      limit ${limit};
    `;

    try {
      return await this.makeRequest('games', igdbQuery);
    } catch (error) {
      console.warn(`IGDB genre search failed for genres: ${genres.join(', ')}`, error);
      return [];
    }
  }

  async getGamesByPlatforms(platforms: string[], excludeIds: number[] = [], limit: number = 20): Promise<IGDBGame[]> {
    if (platforms.length === 0) return [];

    // Use common platform names for better matching
    const platformMap: { [key: string]: string } = {
      "PC (Microsoft Windows)": "PC",
      "PlayStation 5": "PlayStation",
      "PlayStation 4": "PlayStation",
      "Xbox Series X|S": "Xbox",
      "Xbox One": "Xbox",
      "Nintendo Switch": "Nintendo"
    };

    const mappedPlatforms = platforms.slice(0, 3).map(platform => 
      platformMap[platform] || platform.split(' ')[0] // Use first word if no mapping
    );
    const uniquePlatforms = [...new Set(mappedPlatforms)];
    
    const platformConditions = uniquePlatforms.map(platform => 
      `platforms.name ~ *"${platform}"*`
    );
    const platformCondition = platformConditions.join(' | ');
    const excludeCondition = excludeIds.length > 0 ? ` & id != (${excludeIds.join(',')})` : '';

    const igdbQuery = `
      fields name, summary, cover.url, first_release_date, rating, platforms.name, genres.name, screenshots.url;
      where (${platformCondition}) & rating > 70 & rating_count > 5${excludeCondition};
      sort rating desc;
      limit ${limit};
    `;

    try {
      return await this.makeRequest('games', igdbQuery);
    } catch (error) {
      console.warn(`IGDB platform search failed for platforms: ${platforms.join(', ')}`, error);
      return [];
    }
  }

  async getRecommendations(userGames: any[], limit: number = 20): Promise<IGDBGame[]> {
    if (userGames.length === 0) {
      // If user has no games, show popular games
      return this.getPopularGames(limit);
    }

    // Extract genres and platforms from user's games
    const userGenres = Array.from(new Set(
      userGames.flatMap(game => game.genres || [])
    ));
    const userPlatforms = Array.from(new Set(
      userGames.flatMap(game => game.platforms || [])
    ));
    const userIgdbIds = userGames
      .filter(game => game.igdbId)
      .map(game => game.igdbId);

    console.log(`Generating recommendations based on ${userGenres.length} genres and ${userPlatforms.length} platforms, excluding ${userIgdbIds.length} games`);

    const recommendations: IGDBGame[] = [];
    
    try {
      // Get games by favorite genres (60% of results)
      if (userGenres.length > 0) {
        const topGenres = userGenres.slice(0, 5); // Use top 5 genres
        const genreGames = await this.getGamesByGenres(topGenres, userIgdbIds, Math.ceil(limit * 0.6));
        recommendations.push(...genreGames);
      }

      // Get games by platforms (40% of results)
      if (userPlatforms.length > 0 && recommendations.length < limit) {
        const remaining = limit - recommendations.length;
        const platformGames = await this.getGamesByPlatforms(userPlatforms, userIgdbIds, remaining);
        recommendations.push(...platformGames);
      }

      // Fill remaining with popular games if needed
      if (recommendations.length < limit) {
        const remaining = limit - recommendations.length;
        const popularGames = await this.getPopularGames(remaining + 10); // Get extra to filter duplicates
        const filteredPopular = popularGames.filter(game => 
          !userIgdbIds.includes(game.id) && 
          !recommendations.some(rec => rec.id === game.id)
        );
        recommendations.push(...filteredPopular.slice(0, remaining));
      }

      // Remove duplicates and return
      const uniqueRecommendations = recommendations.filter((game, index, self) => 
        index === self.findIndex(g => g.id === game.id)
      );

      console.log(`Generated ${uniqueRecommendations.length} unique recommendations`);
      return uniqueRecommendations.slice(0, limit);

    } catch (error) {
      console.error('Error generating recommendations:', error);
      // Fallback to popular games
      return this.getPopularGames(limit);
    }
  }

  formatGameData(igdbGame: IGDBGame): any {
    return {
      id: `igdb-${igdbGame.id}`,
      igdbId: igdbGame.id,
      title: igdbGame.name,
      summary: igdbGame.summary || '',
      coverUrl: igdbGame.cover?.url ? `https:${igdbGame.cover.url.replace('t_thumb', 't_cover_big')}` : '',
      releaseDate: igdbGame.first_release_date 
        ? new Date(igdbGame.first_release_date * 1000).toISOString().split('T')[0]
        : '',
      rating: igdbGame.rating ? Math.round(igdbGame.rating) / 10 : 0,
      platforms: igdbGame.platforms?.map(p => p.name) || [],
      genres: igdbGame.genres?.map(g => g.name) || [],
      screenshots: igdbGame.screenshots?.map(s => `https:${s.url.replace('t_thumb', 't_screenshot_big')}`) || [],
      status: 'wanted' as const,
    };
  }
}

export const igdbClient = new IGDBClient();