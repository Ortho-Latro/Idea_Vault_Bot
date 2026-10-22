import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOAD_DIR = path.join(__dirname, '../uploads');

if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

export async function downloadTelegramFile(telegramFileUrl, originalExtension = '.mp4') {
    return new Promise((resolve, reject) => {
        const filename = `${uuidv4()}${originalExtension}`;
        const filePath = path.join(UPLOAD_DIR, filename);
        const fileStream = fs.createWriteStream(filePath);

        https.get(telegramFileUrl, (response) => {
            if (response.statusCode !== 200) {
                return reject(new Error(`Failed to download file: Status ${response.statusCode}`));
            }

            response.pipe(fileStream);

            fileStream.on('finish', () => {
                fileStream.close();
                resolve({
                    localPath: filePath,
                    storageUrl: `/uploads/${filename}`
                });
            });
        }).on('error', (err) => {
            fs.unlink(filePath, () => reject(err));
        });
    });
}