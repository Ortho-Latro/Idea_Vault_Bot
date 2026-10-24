import { Telegraf, Scenes, session } from 'telegraf';
import ideaWizard from './wizard.js';
import Idea from '../models/Idea.js';

// PUT YOUR TELEGRAM ID AND YOUR FRIEND'S TELEGRAM ID HERE:
const ALLOWED_USERS = ['917133501', '749059435'];

const MAX_SEARCH_RESULTS = 5;

// Escape user-provided text for Telegram's HTML parse mode
const escapeHtml = (value = '') =>
    String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Escape user-provided text before using it inside a RegExp
const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Build a public video URL; falls back to null when only localhost is available
const buildVideoUrl = (storageUrl) => {
    const baseUrl = (process.env.PUBLIC_URL || process.env.WEBHOOK_URL || '').replace(/\/+$/, '');
    if (!baseUrl || baseUrl.includes('localhost')) return null;
    return `${baseUrl}${storageUrl}`;
};

const truncate = (text = '', max) => (text.length > max ? `${text.slice(0, max)}…` : text);

export default function setupBot(token) {
    const bot = new Telegraf(token);
    const stage = new Scenes.Stage([ideaWizard]);

    // Log unexpected errors instead of crashing the process / webhook handler
    bot.catch((err, ctx) => {
        console.error(`Unhandled bot error for update ${ctx.update?.update_id}:`, err);
    });

    bot.use(session());

    // Security Middleware: Block anyone who is not you or your friend
    bot.use(async (ctx, next) => {
        const userId = ctx.from?.id?.toString();
        if (!userId || !ALLOWED_USERS.includes(userId)) {
            if (ctx.chat) {
                await ctx.reply('⛔ Access Denied. This is a private shared idea vault bot.');
            }
            return;
        }
        return next();
    });

    bot.use(stage.middleware());

    // Command Handlers
    bot.start((ctx) =>
        ctx.reply('Welcome to the Shared Idea Vault! Use /newidea to record a concept, /myideas to view all shared ideas, or /search <name> to look one up.')
    );
    bot.command('newidea', (ctx) => ctx.scene.enter('idea-submission-wizard'));

    // /myideas Command - View ALL ideas shared between you and your friend
    bot.command('myideas', async (ctx) => {
        try {
            const ideas = await Idea.find({ telegramId: { $in: ALLOWED_USERS } }).sort({ createdAt: -1 });

            if (ideas.length === 0) {
                return await ctx.reply('📭 The shared vault is empty! Type /newidea to store your first concept.');
            }
            let responseText = `📂 <b>Shared Idea Vault (${ideas.length}):</b>\n\n`;
            ideas.forEach((idea, index) => {
                responseText += `${index + 1}. <b>${escapeHtml(idea.name)}</b>\n   └ ${escapeHtml(truncate(idea.description, 50))}\n\n`;
            });

            // Telegram caps messages at 4096 characters
            await ctx.reply(truncate(responseText, 4000), { parse_mode: 'HTML' });
        } catch (err) {
            console.error('Error fetching shared ideas:', err);
            await ctx.reply('❌ Failed to retrieve shared ideas.');
        }
    });

    // /search <idea_name> - Search the shared vault (whitelisted users only) by exact name
    bot.command('search', async (ctx) => {
        try {
            const searchName = ctx.message.text.replace(/^\/search(@\w+)?/i, '').trim();

            if (!searchName) {
                return await ctx.reply('⚠️ Please provide a name to search. Example: /search Neural Task Router');
            }

            const ideas = await Idea.find({
                telegramId: { $in: ALLOWED_USERS },
                name: { $regex: new RegExp(`^${escapeRegex(searchName)}$`, 'i') }
            })
                .sort({ createdAt: -1 })
                .limit(MAX_SEARCH_RESULTS);

            if (ideas.length === 0) {
                return await ctx.reply(`❌ No idea found with the name "${searchName}".`);
            }

            const blocks = ideas.map((idea) => {
                let block =
                    `🔍 <b>Found Idea:</b>\n\n` +
                    `• <b>Name:</b> ${escapeHtml(idea.name)}\n` +
                    `• <b>Description:</b> ${escapeHtml(idea.description)}\n`;

                if (idea.video?.storageUrl) {
                    const videoUrl = buildVideoUrl(idea.video.storageUrl);
                    block += videoUrl
                        ? `• <b>Video:</b> <a href="${escapeHtml(videoUrl)}">Play / Download Video</a>\n`
                        : `• <b>Video:</b> attached (no public URL configured)\n`;
                }
                return block;
            });

            await ctx.reply(truncate(blocks.join('\n'), 4000), { parse_mode: 'HTML' });
        } catch (err) {
            console.error('Search command error:', err);
            await ctx.reply('❌ An error occurred while searching.');
        }
    });

    return bot;
}