import { Router } from 'express';

export default function createWebhookRouter(bot, botToken) {
    const router = Router();
    
    router.post(`/webhook/${botToken}`, (req, res) => {
        bot.handleUpdate(req.body, res);
    });

    return router;
}
