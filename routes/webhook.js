import { Router } from 'express';

export default function createWebhookRouter(bot, botToken) {
    const router = Router();

    router.post('/webhook/:token', async (req, res) => {
        if (req.params.token !== botToken) {
            return res.sendStatus(404);
        }

        try {
            await bot.handleUpdate(req.body);
            return res.sendStatus(200);
        } catch (err) {
            console.error('Telegram webhook error:', err);
            return res.sendStatus(500);
        }
    });

    return router;
}
