import { Telegraf, Scenes, session } from 'telegraf';
import ideaWizard from './wizard.js';
import Idea from '../models/Idea.js';

// PUT YOUR TELEGRAM ID AND YOUR FRIEND'S TELEGRAM ID HERE:
const ALLOWED_USERS = ['917133501', '749059435'];

export default function setupBot(token) {
    const bot = new Telegraf(token);
    const stage = new Scenes.Stage([ideaWizard]);

    bot.use(session());

    // Security Middleware: Block anyone who is not you or your friend
    bot.use((ctx, next) => {
        const userId = ctx.from?.id?.toString();
        if (!userId || !ALLOWED_USERS.includes(userId)) {
            return ctx.reply('⛔ Access Denied. This is a private shared idea vault bot.');
        }
        return next();
    });

    bot.use(stage.middleware());

    // Command Handlers
    bot.start((ctx) => ctx.reply('Welcome to the Shared Idea Vault! Use /newidea to record a concept or /myideas to view all shared ideas.'));
    bot.command('newidea', (ctx) => ctx.scene.enter('idea-submission-wizard'));

    // /myideas Command - View ALL ideas shared between you and your friend
    bot.command('myideas', async (ctx) => {
        try {
            // Fetch ideas from ALL whitelisted users instead of just ctx.from.id
            const ideas = await Idea.find({ telegramId: { $in: ALLOWED_USERS } }).sort({ createdAt: -1 });

            if (ideas.length === 0) {
                return ctx.reply('📭 The shared vault is empty! Type /newidea to store your first concept.');
            }

            let responseText = `📂 **Shared Idea Vault (${ideas.length}):**\n\n`;
            ideas.forEach((idea, index) => {
                responseText += `${index + 1}. **${idea.name}**\n   └ ${idea.description.substring(0, 50)}...\n\n`;
            });

            await ctx.reply(responseText, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error('Error fetching shared ideas:', err);
            await ctx.reply('❌ Failed to retrieve shared ideas.');
        }
    });

    // /search <idea_name> command - Search a single idea by name in chat
    bot.command('search', async (ctx) => {
        try {
            const searchName = ctx.message.text.replace('/search', '').trim();

            if (!searchName) {
                return ctx.reply('⚠️ Please provide a name to search. Example: `/search Neural Task Router`', { parse_mode: 'Markdown' });
            }

            const idea = await Idea.findOne({ name: { $regex: new RegExp(`^${searchName}$`, 'i') } });

            if (!idea) {
                return ctx.reply(`❌ No idea found with the name "${searchName}".`);
            }

            let responseText = `🔍 **Found Idea:**\n\n` +
                `• **Name:** ${idea.name}\n` +
                `• **Description:** ${idea.description}\n`;

            if (idea.video && idea.video.storageUrl) {
                responseText += `• **Video Link:** [Play / Download Video](http://localhost:6000${idea.video.storageUrl})\n`;
            }

            await ctx.reply(responseText, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error('Search command error:', err);
            ctx.reply('❌ An error occurred while searching.');
        }
    });

    return bot;
}