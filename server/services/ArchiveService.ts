import node7z from "node-7z";
const { extractFull } = node7z;
import pathTo7zip from "7zip-bin";
import fs from "fs-extra";
import path from "path";

// Ensure 7zip path is correctly resolved
const sevenZipPath = pathTo7zip.path7za;

export class ArchiveService {
  /**
   * Extracts an archive to a specified output directory.
   * @param filePath Full path to the archive file.
   * @param outputDir Directory where contents should be extracted.
   * @returns List of extracted file paths.
   */
  async extract(filePath: string, outputDir: string): Promise<string[]> {
    // eslint-disable-next-line no-console
    console.log(`[ArchiveService] Extracting ${filePath} to ${outputDir}...`);
    
    // Ensure output directory exists
    await fs.ensureDir(outputDir);

    return new Promise((resolve, reject) => {
      const extractedFiles: string[] = [];
      
      const stream = extractFull(filePath, outputDir, {
        $bin: sevenZipPath,
        $progress: true,
        recursive: true, // Extract sub-archives? Maybe not by default to avoid mess. 
        // recursive: true is usually for looking inside archives inside archives. 
        // Let's stick to standard extraction.
      });

      stream.on("data", (data) => {
        // data.file is the relative path of the file being extracted
        if (data.status === "extracted" && data.file) {
          extractedFiles.push(path.join(outputDir, data.file));
        }
      });

      stream.on("end", () => {
        // eslint-disable-next-line no-console
        console.log(`[ArchiveService] Extraction complete. ${extractedFiles.length} files extracted.`);
        resolve(extractedFiles);
      });

      stream.on("error", (err) => {
        console.error(`[ArchiveService] Extraction failed:`, err);
        reject(err);
      });
    });
  }

  isArchive(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return [".zip", ".7z", ".rar", ".gz", ".tar", ".iso", ".bz2"].includes(ext);
  }
}
