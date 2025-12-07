import type { Downloader } from "../shared/schema.js";

/**
 * Extract torrent info hash from a magnet URI.
 * Standardizes to lowercase as per BitTorrent specification (case-insensitive hex encoding).
 * 
 * @param url - The magnet URI or torrent URL
 * @returns The info hash in lowercase, or null if not found
 */
function extractHashFromUrl(url: string): string | null {
  // Extract hash from magnet link - supports both hex (40 chars) and base32 (32 chars) formats
  const magnetMatch = url.match(/xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
  if (magnetMatch) {
    return magnetMatch[1].toLowerCase();
  }
  return null;
}

interface DownloadRequest {
  url: string;
  title: string;
  category?: string;
  downloadPath?: string;
  priority?: number;
}

interface DownloadStatus {
  id: string;
  name: string;
  status: 'downloading' | 'seeding' | 'completed' | 'paused' | 'error';
  progress: number; // 0-100
  downloadSpeed?: number; // bytes per second
  uploadSpeed?: number; // bytes per second
  eta?: number; // seconds
  size?: number; // total bytes
  downloaded?: number; // bytes downloaded
  seeders?: number;
  leechers?: number;
  ratio?: number;
  error?: string;
}

interface DownloaderClient {
  testConnection(): Promise<{ success: boolean; message: string }>;
  addTorrent(request: DownloadRequest): Promise<{ success: boolean; id?: string; message: string }>;
  getTorrentStatus(id: string): Promise<DownloadStatus | null>;
  getAllTorrents(): Promise<DownloadStatus[]>;
  pauseTorrent(id: string): Promise<{ success: boolean; message: string }>;
  resumeTorrent(id: string): Promise<{ success: boolean; message: string }>;
  removeTorrent(id: string, deleteFiles?: boolean): Promise<{ success: boolean; message: string }>;
}

class TransmissionClient implements DownloaderClient {
  private downloader: Downloader;
  private sessionId: string | null = null;

  constructor(downloader: Downloader) {
    this.downloader = downloader;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      const response = await this.makeRequest('session-get', {});
      return { success: true, message: 'Connected successfully to Transmission' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Failed to connect to Transmission: ${errorMessage}` };
    }
  }

  async addTorrent(request: DownloadRequest): Promise<{ success: boolean; id?: string; message: string }> {
    try {
      const args: any = {
        filename: request.url,
      };

      if (request.downloadPath || this.downloader.downloadPath) {
        args['download-dir'] = request.downloadPath || this.downloader.downloadPath;
      }

      if (request.priority) {
        args['priority-high'] = request.priority > 3;
        args['priority-low'] = request.priority < 2;
      }

      const response = await this.makeRequest('torrent-add', args);
      
      if (response.arguments['torrent-added']) {
        const torrent = response.arguments['torrent-added'];
        return { 
          success: true, 
          id: torrent.id?.toString(), 
          message: 'Torrent added successfully' 
        };
      } else if (response.arguments['torrent-duplicate']) {
        return { 
          success: false, 
          message: 'Torrent already exists' 
        };
      } else {
        return { 
          success: false, 
          message: 'Failed to add torrent' 
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Failed to add torrent: ${errorMessage}` };
    }
  }

  async getTorrentStatus(id: string): Promise<DownloadStatus | null> {
    try {
      const response = await this.makeRequest('torrent-get', {
        ids: [parseInt(id)],
        fields: [
          'id', 'name', 'status', 'percentDone', 'rateDownload', 'rateUpload',
          'eta', 'totalSize', 'downloadedEver', 'peersSendingToUs', 'peersGettingFromUs',
          'uploadRatio', 'errorString'
        ]
      });

      if (response.arguments.torrents && response.arguments.torrents.length > 0) {
        const torrent = response.arguments.torrents[0];
        return this.mapTransmissionStatus(torrent);
      }

      return null;
    } catch (error) {
      console.error('Error getting torrent status:', error);
      return null;
    }
  }

  async getAllTorrents(): Promise<DownloadStatus[]> {
    const response = await this.makeRequest('torrent-get', {
      fields: [
        'id', 'name', 'status', 'percentDone', 'rateDownload', 'rateUpload',
        'eta', 'totalSize', 'downloadedEver', 'peersSendingToUs', 'peersGettingFromUs',
        'uploadRatio', 'errorString'
      ]
    });

    if (response.arguments.torrents) {
      return response.arguments.torrents.map((torrent: any) => this.mapTransmissionStatus(torrent));
    }

    return [];
  }

  async pauseTorrent(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeRequest('torrent-stop', { ids: [parseInt(id)] });
      return { success: true, message: 'Torrent paused successfully' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Failed to pause torrent: ${errorMessage}` };
    }
  }

  async resumeTorrent(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeRequest('torrent-start', { ids: [parseInt(id)] });
      return { success: true, message: 'Torrent resumed successfully' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Failed to resume torrent: ${errorMessage}` };
    }
  }

  async removeTorrent(id: string, deleteFiles = false): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeRequest('torrent-remove', { 
        ids: [parseInt(id)], 
        'delete-local-data': deleteFiles 
      });
      return { success: true, message: 'Torrent removed successfully' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Failed to remove torrent: ${errorMessage}` };
    }
  }

  private mapTransmissionStatus(torrent: any): DownloadStatus {
    // Transmission status codes: 0=stopped, 1=check pending, 2=checking, 3=download pending, 4=downloading, 5=seed pending, 6=seeding
    let status: DownloadStatus['status'] = 'paused';
    
    switch (torrent.status) {
      case 0: status = 'paused'; break;
      case 4: status = 'downloading'; break;
      case 6: status = 'seeding'; break;
      case 1:
      case 2:
      case 3:
      case 5: status = 'downloading'; break;
      default: status = 'error'; break;
    }

    if (torrent.percentDone === 1) {
      status = 'completed';
    }

    if (torrent.errorString) {
      status = 'error';
    }

    return {
      id: torrent.id.toString(),
      name: torrent.name,
      status,
      progress: Math.round(torrent.percentDone * 100),
      downloadSpeed: torrent.rateDownload,
      uploadSpeed: torrent.rateUpload,
      eta: torrent.eta > 0 ? torrent.eta : undefined,
      size: torrent.totalSize,
      downloaded: torrent.downloadedEver,
      seeders: torrent.peersSendingToUs,
      leechers: torrent.peersGettingFromUs,
      ratio: torrent.uploadRatio,
      error: torrent.errorString || undefined,
    };
  }

  private async makeRequest(method: string, arguments_: any): Promise<any> {
    const url = this.downloader.url.endsWith('/') 
      ? this.downloader.url 
      : this.downloader.url + '/';

    const body = {
      method,
      arguments: arguments_,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'GameRadarr/1.0',
    };

    if (this.sessionId) {
      headers['X-Transmission-Session-Id'] = this.sessionId;
    }

    if (this.downloader.username && this.downloader.password) {
      const auth = Buffer.from(`${this.downloader.username}:${this.downloader.password}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });

    // Handle session ID requirement for Transmission
    if (response.status === 409) {
      const sessionId = response.headers.get('X-Transmission-Session-Id');
      if (sessionId) {
        this.sessionId = sessionId;
        headers['X-Transmission-Session-Id'] = sessionId;
        
        // Retry with session ID
        const retryResponse = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(30000),
        });

        if (!retryResponse.ok) {
          throw new Error(`HTTP ${retryResponse.status}: ${retryResponse.statusText}`);
        }

        return retryResponse.json();
      }
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }
}

/**
 * rTorrent/ruTorrent client implementation using XML-RPC protocol.
 * 
 * @remarks
 * - Communicates via XML-RPC to the /RPC2 endpoint
 * - Uses d.multicall2 for efficient batch operations
 * - Status mapping: state (0=stopped, 1=started) + complete (0/1)
 * - Supports Basic Authentication via username/password
 */
class RTorrentClient implements DownloaderClient {
  private downloader: Downloader;

  constructor(downloader: Downloader) {
    this.downloader = downloader;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      // Test connection by getting rTorrent version
      await this.makeXMLRPCRequest('system.client_version', []);
      return { success: true, message: 'Connected successfully to rTorrent' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Failed to connect to rTorrent: ${errorMessage}` };
    }
  }

  async addTorrent(request: DownloadRequest): Promise<{ success: boolean; id?: string; message: string }> {
    try {
      if (!request.url) {
        return { 
          success: false, 
          message: 'Torrent URL is required' 
        };
      }

      // rTorrent uses load.start for adding and starting torrents
      // The method returns 0 on success (or sometimes the hash as a string)
      const result = await this.makeXMLRPCRequest('load.start', ['', request.url]);
      
      // Handle both 0 (success) and string hash responses
      if (result === 0 || typeof result === 'string') {
        let hash: string;
        if (typeof result === 'string' && result !== '0') {
          // Some implementations return the hash directly
          hash = result;
        } else {
          // Extract hash from magnet link or torrent URL
          hash = extractHashFromUrl(request.url) || 'unknown';
        }
        
        return { 
          success: true, 
          id: hash, 
          message: 'Torrent added successfully' 
        };
      } else {
        return { 
          success: false, 
          message: 'Failed to add torrent' 
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Failed to add torrent: ${errorMessage}` };
    }
  }

  async getTorrentStatus(id: string): Promise<DownloadStatus | null> {
    try {
      // Get detailed information about a specific torrent using multicall
      const result = await this.makeXMLRPCRequest('d.multicall2', [
        '',
        id,
        'd.hash=',
        'd.name=',
        'd.state=',
        'd.complete=',
        'd.size_bytes=',
        'd.completed_bytes=',
        'd.down.rate=',
        'd.up.rate=',
        'd.ratio=',
        'd.peers_connected=',
        'd.peers_complete=',
        'd.message='
      ]);

      if (result && result.length > 0) {
        const torrent = result[0];
        return this.mapRTorrentStatus(torrent);
      }

      return null;
    } catch (error) {
      console.error('Error getting torrent status:', error);
      return null;
    }
  }

  async getAllTorrents(): Promise<DownloadStatus[]> {
    // Get all torrents using multicall
    const result = await this.makeXMLRPCRequest('d.multicall2', [
      '',
      'main',
      'd.hash=',
      'd.name=',
      'd.state=',
      'd.complete=',
      'd.size_bytes=',
      'd.completed_bytes=',
      'd.down.rate=',
      'd.up.rate=',
      'd.ratio=',
      'd.peers_connected=',
      'd.peers_complete=',
      'd.message='
    ]);

    if (result) {
      return result.map((torrent: any) => this.mapRTorrentStatus(torrent));
    }

    return [];
  }

  async pauseTorrent(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeXMLRPCRequest('d.stop', [id]);
      return { success: true, message: 'Torrent paused successfully' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Failed to pause torrent: ${errorMessage}` };
    }
  }

  async resumeTorrent(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.makeXMLRPCRequest('d.start', [id]);
      return { success: true, message: 'Torrent resumed successfully' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Failed to resume torrent: ${errorMessage}` };
    }
  }

  async removeTorrent(id: string, deleteFiles = false): Promise<{ success: boolean; message: string }> {
    try {
      if (deleteFiles) {
        // Stop torrent, delete data, and remove from client
        await this.makeXMLRPCRequest('d.stop', [id]);
        await this.makeXMLRPCRequest('d.delete_tied', [id]); // Delete files
        await this.makeXMLRPCRequest('d.erase', [id]);
      } else {
        // Just remove from client without deleting files
        await this.makeXMLRPCRequest('d.erase', [id]);
      }
      return { success: true, message: 'Torrent removed successfully' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Failed to remove torrent: ${errorMessage}` };
    }
  }

  private mapRTorrentStatus(torrent: any): DownloadStatus {
    // torrent is an array: [hash, name, state, complete, size, completed, down_rate, up_rate, ratio, peers_connected, peers_complete, message]
    const [hash, name, state, complete, sizeBytes, completedBytes, downRate, upRate, ratio, peersConnected, peersComplete, message] = torrent;
    
    // rTorrent state: 0=stopped, 1=started
    // complete: 0=incomplete, 1=complete
    let status: DownloadStatus['status'];
    
    if (state === 1) {
      if (complete === 1) {
        status = 'seeding';
      } else {
        status = 'downloading';
      }
    } else {
      if (complete === 1) {
        status = 'completed';
      } else {
        status = 'paused';
      }
    }

    if (message && message.length > 0) {
      status = 'error';
    }

    const progress = sizeBytes > 0 ? Math.round((completedBytes / sizeBytes) * 100) : 0;

    return {
      id: hash,
      name,
      status,
      progress,
      downloadSpeed: downRate,
      uploadSpeed: upRate,
      size: sizeBytes,
      downloaded: completedBytes,
      seeders: peersComplete,
      leechers: Math.max(0, peersConnected - peersComplete),
      ratio: ratio / 1000, // rTorrent returns ratio * 1000
      error: message || undefined,
    };
  }

  private async makeXMLRPCRequest(method: string, params: any[]): Promise<any> {
    const url = this.downloader.url.endsWith('/') 
      ? this.downloader.url + 'RPC2' 
      : this.downloader.url + '/RPC2';

    // Build XML-RPC request
    const xmlParams = params.map(param => {
      if (typeof param === 'string') {
        return `<param><value><string>${this.escapeXml(param)}</string></value></param>`;
      } else if (typeof param === 'number') {
        return `<param><value><int>${param}</int></value></param>`;
      }
      return `<param><value><string>${this.escapeXml(String(param))}</string></value></param>`;
    }).join('');

    const xmlBody = `<?xml version="1.0"?>
<methodCall>
  <methodName>${this.escapeXml(method)}</methodName>
  <params>
    ${xmlParams}
  </params>
</methodCall>`;

    const headers: Record<string, string> = {
      'Content-Type': 'text/xml',
      'User-Agent': 'GameRadarr/1.0',
    };

    if (this.downloader.username && this.downloader.password) {
      const auth = Buffer.from(`${this.downloader.username}:${this.downloader.password}`).toString('base64');
      headers['Authorization'] = `Basic ${auth}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: xmlBody,
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const responseText = await response.text();
    return this.parseXMLRPCResponse(responseText);
  }

  private parseXMLRPCResponse(xml: string): any {
    // Simple XML-RPC response parser
    // Extract the value from <methodResponse><params><param><value>...</value></param></params></methodResponse>
    
    // Check for fault
    if (xml.includes('<fault>')) {
      const faultStringMatch = xml.match(/<name>faultString<\/name>\s*<value><string>([^<]+)<\/string>/);
      if (faultStringMatch) {
        throw new Error(`XML-RPC Fault: ${faultStringMatch[1]}`);
      }
      throw new Error('XML-RPC Fault occurred');
    }

    // Find the main response value
    const paramValueMatch = xml.match(/<methodResponse>\s*<params>\s*<param>\s*<value>([\s\S]*?)<\/value>\s*<\/param>\s*<\/params>\s*<\/methodResponse>/);
    if (!paramValueMatch) {
      return null;
    }

    const valueContent = paramValueMatch[1].trim();

    // Parse array responses (for multicall)
    if (valueContent.startsWith('<array>')) {
      return this.parseXMLArray(valueContent);
    }

    // Parse string response
    const stringMatch = valueContent.match(/<string>([^<]*)<\/string>/);
    if (stringMatch) {
      return this.unescapeXml(stringMatch[1]);
    }

    // Parse int response
    const intMatch = valueContent.match(/<int>([^<]+)<\/int>/) || valueContent.match(/<i4>([^<]+)<\/i4>/);
    if (intMatch) {
      return parseInt(intMatch[1]);
    }

    // Parse double response
    const doubleMatch = valueContent.match(/<double>([^<]+)<\/double>/);
    if (doubleMatch) {
      return parseFloat(doubleMatch[1]);
    }

    return null;
  }

  private parseXMLArray(arrayXml: string): any[] {
    const result: any[] = [];
    
    // Extract the data section from <array><data>...</data></array>
    const dataMatch = arrayXml.match(/<array>\s*<data>([\s\S]*)<\/data>\s*<\/array>/);
    if (!dataMatch) {
      return result;
    }

    const dataContent = dataMatch[1];
    
    // Parse each value in the array
    // We need to be careful with nested structures
    let depth = 0;
    let currentValue = '';
    let inValue = false;
    
    for (let i = 0; i < dataContent.length; i++) {
      const char = dataContent[i];
      
      if (dataContent.substring(i, i + 7) === '<value>') {
        if (!inValue) {
          inValue = true;
          currentValue = '<value>';
          i += 6;
          depth = 1;
          continue;
        } else {
          depth++;
        }
      } else if (dataContent.substring(i, i + 8) === '</value>') {
        depth--;
        if (depth === 0 && inValue) {
          currentValue += '</value>';
          // Parse this value
          result.push(this.parseXMLValue(currentValue));
          currentValue = '';
          inValue = false;
          i += 7;
          continue;
        }
      }
      
      if (inValue) {
        currentValue += char;
      }
    }

    return result;
  }

  private parseXMLValue(valueXml: string): any {
    // Extract content between <value> and </value>
    const contentMatch = valueXml.match(/<value>([\s\S]*)<\/value>/);
    if (!contentMatch) {
      return '';
    }
    
    const content = contentMatch[1].trim();
    
    // Check if this is a nested array
    if (content.startsWith('<array>')) {
      return this.parseXMLArray(content);
    }

    // Parse string
    const stringMatch = content.match(/<string>([^<]*)<\/string>/);
    if (stringMatch) {
      return this.unescapeXml(stringMatch[1]);
    }

    // Parse int
    const intMatch = content.match(/<int>([^<]+)<\/int>/) || content.match(/<i4>([^<]+)<\/i4>/);
    if (intMatch) {
      return parseInt(intMatch[1]);
    }

    // Parse double
    const doubleMatch = content.match(/<double>([^<]+)<\/double>/);
    if (doubleMatch) {
      return parseFloat(doubleMatch[1]);
    }

    return '';
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private unescapeXml(str: string): string {
    return str
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&'); // Must be last
  }
}

/**
 * qBittorrent client implementation using Web API v2.
 * 
 * @remarks
 * - Uses cookie-based authentication via /api/v2/auth/login
 * - All torrent operations use /api/v2/torrents/* endpoints
 * - Status mapping: state field from API response
 * - Supports username/password authentication
 */
class QBittorrentClient implements DownloaderClient {
  private downloader: Downloader;
  private cookie: string | null = null;
  
  // Maximum ETA value to consider valid (100 days in seconds)
  // qBittorrent returns very large values when ETA is essentially infinite
  private static readonly MAX_VALID_ETA_SECONDS = 8640000;

  constructor(downloader: Downloader) {
    this.downloader = downloader;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    try {
      await this.authenticate();
      // Test by getting app version
      const response = await this.makeRequest('GET', '/api/v2/app/version');
      const version = await response.text();
      return { success: true, message: `Connected successfully to qBittorrent ${version}` };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Failed to connect to qBittorrent: ${errorMessage}` };
    }
  }

  async addTorrent(request: DownloadRequest): Promise<{ success: boolean; id?: string; message: string }> {
    try {
      if (!request.url) {
        return { 
          success: false, 
          message: 'Torrent URL is required' 
        };
      }

      await this.authenticate();

      // Build form data for adding torrent
      const formData = new URLSearchParams();
      formData.append('urls', request.url);
      
      if (request.downloadPath || this.downloader.downloadPath) {
        formData.append('savepath', request.downloadPath || this.downloader.downloadPath || '');
      }
      
      if (request.category || this.downloader.category) {
        formData.append('category', request.category || this.downloader.category || '');
      }

      const response = await this.makeRequest('POST', '/api/v2/torrents/add', formData.toString(), {
        'Content-Type': 'application/x-www-form-urlencoded',
      });

      const responseText = await response.text();
      
      if (response.ok && (responseText === 'Ok.' || responseText === '')) {
        // Extract hash from magnet or generate a placeholder
        const hash = extractHashFromUrl(request.url);
        return { 
          success: true, 
          id: hash || 'added', 
          message: 'Torrent added successfully' 
        };
      } else if (responseText === 'Fails.') {
        return { 
          success: false, 
          message: 'Torrent already exists or invalid torrent' 
        };
      } else {
        return { 
          success: false, 
          message: `Failed to add torrent: ${responseText}` 
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Failed to add torrent: ${errorMessage}` };
    }
  }

  async getTorrentStatus(id: string): Promise<DownloadStatus | null> {
    try {
      await this.authenticate();
      
      const response = await this.makeRequest('GET', `/api/v2/torrents/info?hashes=${id}`);
      const torrents = await response.json() as any[];
      
      if (torrents && torrents.length > 0) {
        return this.mapQBittorrentStatus(torrents[0]);
      }
      
      return null;
    } catch (error) {
      console.error('Error getting torrent status:', error);
      return null;
    }
  }

  async getAllTorrents(): Promise<DownloadStatus[]> {
    try {
      await this.authenticate();
      
      const response = await this.makeRequest('GET', '/api/v2/torrents/info');
      const torrents = await response.json() as any[];
      
      if (torrents) {
        return torrents.map((torrent: any) => this.mapQBittorrentStatus(torrent));
      }
      
      return [];
    } catch (error) {
      console.error('Error getting all torrents:', error);
      return [];
    }
  }

  async pauseTorrent(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.authenticate();
      
      const formData = new URLSearchParams();
      formData.append('hashes', id);
      
      await this.makeRequest('POST', '/api/v2/torrents/pause', formData.toString(), {
        'Content-Type': 'application/x-www-form-urlencoded',
      });
      
      return { success: true, message: 'Torrent paused successfully' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Failed to pause torrent: ${errorMessage}` };
    }
  }

  async resumeTorrent(id: string): Promise<{ success: boolean; message: string }> {
    try {
      await this.authenticate();
      
      const formData = new URLSearchParams();
      formData.append('hashes', id);
      
      await this.makeRequest('POST', '/api/v2/torrents/resume', formData.toString(), {
        'Content-Type': 'application/x-www-form-urlencoded',
      });
      
      return { success: true, message: 'Torrent resumed successfully' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Failed to resume torrent: ${errorMessage}` };
    }
  }

  async removeTorrent(id: string, deleteFiles = false): Promise<{ success: boolean; message: string }> {
    try {
      await this.authenticate();
      
      const formData = new URLSearchParams();
      formData.append('hashes', id);
      formData.append('deleteFiles', deleteFiles.toString());
      
      await this.makeRequest('POST', '/api/v2/torrents/delete', formData.toString(), {
        'Content-Type': 'application/x-www-form-urlencoded',
      });
      
      return { success: true, message: 'Torrent removed successfully' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: `Failed to remove torrent: ${errorMessage}` };
    }
  }

  private mapQBittorrentStatus(torrent: any): DownloadStatus {
    // qBittorrent state values:
    // uploading, stalledUP, checkingUP, pausedUP, queuedUP, forcedUP - seeding states
    // downloading, stalledDL, checkingDL, pausedDL, queuedDL, forcedDL - downloading states
    // allocating, metaDL, checkingResumeData - downloading states
    // error, missingFiles, unknown - error states
    let status: DownloadStatus['status'];
    
    switch (torrent.state) {
      case 'uploading':
      case 'stalledUP':
      case 'checkingUP':
      case 'forcedUP':
      case 'queuedUP':
        status = 'seeding';
        break;
      case 'pausedUP':
        status = 'completed';
        break;
      case 'downloading':
      case 'stalledDL':
      case 'checkingDL':
      case 'forcedDL':
      case 'queuedDL':
      case 'allocating':
      case 'metaDL':
      case 'checkingResumeData':
        status = 'downloading';
        break;
      case 'pausedDL':
        status = 'paused';
        break;
      case 'error':
      case 'missingFiles':
      case 'unknown':
      default:
        status = 'error';
        break;
    }

    // Check if completed
    if (torrent.progress === 1 && status === 'paused') {
      status = 'completed';
    }

    return {
      id: torrent.hash,
      name: torrent.name,
      status,
      progress: Math.round(torrent.progress * 100),
      downloadSpeed: torrent.dlspeed,
      uploadSpeed: torrent.upspeed,
      eta: torrent.eta > 0 && torrent.eta < QBittorrentClient.MAX_VALID_ETA_SECONDS ? torrent.eta : undefined,
      size: torrent.size,
      downloaded: torrent.downloaded,
      seeders: torrent.num_seeds,
      leechers: torrent.num_leechs,
      ratio: torrent.ratio,
      error: torrent.state === 'error' ? 'Torrent error' : undefined,
    };
  }

  private async authenticate(): Promise<void> {
    if (this.cookie) {
      return; // Already authenticated
    }

    if (!this.downloader.username || !this.downloader.password) {
      // Try without authentication
      return;
    }

    const url = this.getBaseUrl() + '/api/v2/auth/login';
    
    const formData = new URLSearchParams();
    formData.append('username', this.downloader.username);
    formData.append('password', this.downloader.password);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'GameRadarr/1.0',
      },
      body: formData.toString(),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      throw new Error(`Authentication failed: ${response.status} ${response.statusText}`);
    }

    const responseText = await response.text();
    if (responseText !== 'Ok.') {
      throw new Error('Authentication failed: Invalid credentials');
    }

    // Extract session cookie
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      const match = setCookie.match(/SID=([^;]+)/);
      if (match) {
        this.cookie = `SID=${match[1]}`;
      }
    }
  }

  private getBaseUrl(): string {
    let url = this.downloader.url;
    // Remove trailing slash
    if (url.endsWith('/')) {
      url = url.slice(0, -1);
    }
    return url;
  }

  private async makeRequest(
    method: string, 
    path: string, 
    body?: string,
    additionalHeaders?: Record<string, string>
  ): Promise<Response> {
    const url = this.getBaseUrl() + path;

    const headers: Record<string, string> = {
      'User-Agent': 'GameRadarr/1.0',
      ...additionalHeaders,
    };

    if (this.cookie) {
      headers['Cookie'] = this.cookie;
    }

    const response = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' ? body : undefined,
      signal: AbortSignal.timeout(30000),
    });

    if (response.status === 403) {
      // Session expired, re-authenticate
      this.cookie = null;
      await this.authenticate();
      
      // Retry with new cookie
      if (this.cookie) {
        headers['Cookie'] = this.cookie;
      }
      
      return fetch(url, {
        method,
        headers,
        body: method !== 'GET' ? body : undefined,
        signal: AbortSignal.timeout(30000),
      });
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response;
  }
}

export class DownloaderManager {
  static createClient(downloader: Downloader): DownloaderClient {
    switch (downloader.type) {
      case 'transmission':
        return new TransmissionClient(downloader);
      case 'rtorrent':
        return new RTorrentClient(downloader);
      case 'qbittorrent':
        return new QBittorrentClient(downloader);
      default:
        throw new Error(`Unsupported downloader type: ${downloader.type}`);
    }
  }

  static async testDownloader(downloader: Downloader): Promise<{ success: boolean; message: string }> {
    try {
      const client = this.createClient(downloader);
      return await client.testConnection();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: errorMessage };
    }
  }

  static async addTorrent(
    downloader: Downloader, 
    request: DownloadRequest
  ): Promise<{ success: boolean; id?: string; message: string }> {
    try {
      const client = this.createClient(downloader);
      return await client.addTorrent(request);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: errorMessage };
    }
  }

  static async getAllTorrents(downloader: Downloader): Promise<DownloadStatus[]> {
    const client = this.createClient(downloader);
    return await client.getAllTorrents();
  }

  static async getTorrentStatus(downloader: Downloader, id: string): Promise<DownloadStatus | null> {
    try {
      const client = this.createClient(downloader);
      return await client.getTorrentStatus(id);
    } catch (error) {
      console.error('Error getting torrent status:', error);
      return null;
    }
  }

  static async pauseTorrent(downloader: Downloader, id: string): Promise<{ success: boolean; message: string }> {
    try {
      const client = this.createClient(downloader);
      return await client.pauseTorrent(id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: errorMessage };
    }
  }

  static async resumeTorrent(downloader: Downloader, id: string): Promise<{ success: boolean; message: string }> {
    try {
      const client = this.createClient(downloader);
      return await client.resumeTorrent(id);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: errorMessage };
    }
  }

  static async removeTorrent(
    downloader: Downloader, 
    id: string, 
    deleteFiles = false
  ): Promise<{ success: boolean; message: string }> {
    try {
      const client = this.createClient(downloader);
      return await client.removeTorrent(id, deleteFiles);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return { success: false, message: errorMessage };
    }
  }

  static async addTorrentWithFallback(
    downloaders: Downloader[],
    request: DownloadRequest
  ): Promise<{ 
    success: boolean; 
    id?: string; 
    message?: string; 
    downloaderId?: string;
    downloaderName?: string;
    attemptedDownloaders: string[];
  }> {
    if (downloaders.length === 0) {
      return { 
        success: false, 
        message: 'No downloaders available',
        attemptedDownloaders: []
      };
    }

    const attemptedDownloaders: string[] = [];
    const errors: string[] = [];

    for (const downloader of downloaders) {
      attemptedDownloaders.push(downloader.name);
      
      try {
        const result = await this.addTorrent(downloader, request);
        
        if (result.success) {
          return {
            ...result,
            downloaderId: downloader.id,
            downloaderName: downloader.name,
            attemptedDownloaders
          };
        } else {
          errors.push(`${downloader.name}: ${result.message}`);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${downloader.name}: ${errorMessage}`);
      }
    }

    // All downloaders failed
    return {
      success: false,
      message: `All downloaders failed. Errors: ${errors.join('; ')}`,
      attemptedDownloaders
    };
  }
}

export { DownloadRequest, DownloadStatus, DownloaderClient };