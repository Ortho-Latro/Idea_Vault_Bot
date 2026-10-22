import { Router } from 'express';
import Idea from '../models/Idea.js';

const router = Router();

// GET /api/ideas/lookup?name=IdeaName (Searches across the entire shared vault)
router.get('/lookup', async (req, res) => {
    try {
        const { name } = req.query;
        if (!name) {
            return res.status(400).json({ error: 'Query parameter "name" is required.' });
        }

        const query = { name: { $regex: new RegExp(`^${name}$`, 'i') } };
        const idea = await Idea.findOne(query);

        if (!idea) {
            return res.status(404).json({ error: `No idea found with the name "${name}".` });
        }

        return res.status(200).json({ success: true, data: idea });
    } catch (err) {
        console.error('Lookup API error:', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

// GET /api/ideas/all (Fetches all ideas from the shared vault)
router.get('/all', async (req, res) => {
    try {
        const ideas = await Idea.find({}).sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            count: ideas.length,
            data: ideas
        });
    } catch (err) {
        console.error('Fetch all API error:', err);
        return res.status(500).json({ error: 'Internal server error.' });
    }
});

export default router;