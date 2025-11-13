import type { Downloader } from "@shared/schema";

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
    try {
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
    } catch (error) {
      console.error('Error getting all torrents:', error);
      return [];
    }
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

// Placeholder implementations for other client types
class QBittorrentClient implements DownloaderClient {
  private downloader: Downloader;

  constructor(downloader: Downloader) {
    this.downloader = downloader;
  }

  async testConnection(): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'qBittorrent client not yet implemented' };
  }

  async addTorrent(request: DownloadRequest): Promise<{ success: boolean; id?: string; message: string }> {
    return { success: false, message: 'qBittorrent client not yet implemented' };
  }

  async getTorrentStatus(id: string): Promise<DownloadStatus | null> {
    return null;
  }

  async getAllTorrents(): Promise<DownloadStatus[]> {
    return [];
  }

  async pauseTorrent(id: string): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'qBittorrent client not yet implemented' };
  }

  async resumeTorrent(id: string): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'qBittorrent client not yet implemented' };
  }

  async removeTorrent(id: string, deleteFiles?: boolean): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'qBittorrent client not yet implemented' };
  }
}

export class DownloaderManager {
  static createClient(downloader: Downloader): DownloaderClient {
    switch (downloader.type) {
      case 'transmission':
        return new TransmissionClient(downloader);
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
    try {
      const client = this.createClient(downloader);
      return await client.getAllTorrents();
    } catch (error) {
      console.error('Error getting torrents:', error);
      return [];
    }
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