import express from 'express';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import setupBot from './bot/index.js';
import createWebhookRouter from './routes/webhook.js';
import apiRouter from './routes/api.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// Serve uploaded video files statically
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch((err) => console.error('MongoDB connection error:', err));

// Initialize Bot
const bot = setupBot(process.env.BOT_TOKEN);

// Mount Webhook and API Routers
app.use(createWebhookRouter(bot, process.env.BOT_TOKEN));
app.use('/api/ideas', apiRouter);

// Start Server locally (skipped when running on Vercel serverless environment)
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, async () => {
        console.log(`Server running on port ${PORT}`);

        if (process.env.WEBHOOK_URL && !process.env.WEBHOOK_URL.includes('localhost')) {
            // Only register webhook automatically if using a public HTTPS tunnel/URL
            const webhookPath = `${process.env.WEBHOOK_URL}/webhook/${process.env.BOT_TOKEN}`;
            try {
                await bot.telegram.setWebhook(webhookPath);
                console.log(`Telegram webhook registered at: ${webhookPath}`);
            } catch (err) {
                console.error('Failed to set webhook:', err.message);
            }
        } else {
            console.log('Running locally. Skipping automatic webhook registration until public HTTPS URL is provided.');
        }
    });
}

// Export app for Vercel serverless execution
export default app;