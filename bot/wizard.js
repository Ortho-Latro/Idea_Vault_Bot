import { Scenes, Markup } from 'telegraf';
import { v4 as uuidv4 } from 'uuid';
import { downloadTelegramFile } from '../services/storage.js';
import Idea from '../models/Idea.js';

const ideaWizard = new Scenes.WizardScene(
    'idea-submission-wizard',
    
    // Step 1: Prompt for Idea Name
    async (ctx) => {
        await ctx.reply('💡 Let\'s store a new idea.\n\nFirst, what is the **name** of your idea?');
        ctx.wizard.state.ideaData = {};
        return ctx.wizard.next();
    },

    // Step 2: Capture Name, Prompt for Description
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) {
            await ctx.reply('Please send a valid text name.');
            return;
        }
        ctx.wizard.state.ideaData.name = ctx.message.text.trim();
        await ctx.reply(`Got it: **${ctx.wizard.state.ideaData.name}**.\n\nNow, provide a **description** or paste your notes:`);
        return ctx.wizard.next();
    },

    // Step 3: Capture Description, Prompt for Video
    async (ctx) => {
        if (!ctx.message || !ctx.message.text) {
            await ctx.reply('Please send a valid description.');
            return;
        }
        ctx.wizard.state.ideaData.description = ctx.message.text.trim();
        ctx.wizard.state.ideaData.extractedText = ctx.message.text.trim();

        await ctx.reply(
            '🎬 Upload a **video** explaining your idea, or click "Skip Video".',
            Markup.inlineKeyboard([Markup.button.callback('Skip Video', 'skip_video')])
        );
        return ctx.wizard.next();
    },

    // Step 4: Handle Video Upload (Wait for video or skip action)
    async (ctx) => {
        const stateData = ctx.wizard.state.ideaData;

        if (ctx.message && ctx.message.video) {
            const video = ctx.message.video;
            await ctx.reply('Processing video file...');
            
            try {
                const fileLink = await ctx.telegram.getFileLink(video.file_id);
                const savedFile = await downloadTelegramFile(fileLink.href, '.mp4');

                stateData.video = {
                    fileId: video.file_id,
                    storageUrl: savedFile.storageUrl,
                    mimeType: video.mime_type || 'video/mp4',
                    sizeBytes: video.file_size || 0
                };
            } catch (err) {
                console.error('Video error:', err);
                stateData.video = null;
            }
        } else {
            stateData.video = null;
        }

        const summaryText = `📋 **Idea Review Summary**\n\n` +
            `• **Name:** ${stateData.name}\n` +
            `• **Description:** ${stateData.description}\n` +
            `• **Video:** ${stateData.video ? 'Attached' : 'None'}`;

        await ctx.reply(summaryText, {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([
                [Markup.button.callback('✅ Save Idea', 'save_idea')],
                [Markup.button.callback('❌ Cancel', 'cancel_idea')]
            ])
        });

        return ctx.wizard.next();
    },

    // Step 5: Final Step (Placeholder so wizard stays active for button actions)
    async (ctx) => {
        // Handled entirely by action triggers below to prevent duplicate message processing
        return;
    }
);

// --- Dedicated Action Handlers for Inline Buttons ---

// Handle "Skip Video" button click from Step 3
ideaWizard.action('skip_video', async (ctx) => {
    await ctx.answerCbQuery();
    ctx.wizard.state.ideaData.video = null;
    
    const stateData = ctx.wizard.state.ideaData;
    const summaryText = `📋 **Idea Review Summary**\n\n` +
        `• **Name:** ${stateData.name}\n` +
        `• **Description:** ${stateData.description}\n` +
        `• **Video:** None`;

    await ctx.editMessageText(summaryText, {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
            [Markup.button.callback('✅ Save Idea', 'save_idea')],
            [Markup.button.callback('❌ Cancel', 'cancel_idea')]
        ])
    });

    // Move wizard state forward to step 4 (index 4)
    return ctx.wizard.selectStep(4);
});

// Handle "Save Idea" button click
ideaWizard.action('save_idea', async (ctx) => {
    await ctx.answerCbQuery();
    try {
        const stateData = ctx.wizard.state.ideaData;
        
        const newIdea = new Idea({
            IdeaId: uuidv4(),
            telegramId: ctx.from.id.toString(),
            name: stateData.name,
            description: stateData.description,
            extractedText: stateData.extractedText,
            video: stateData.video || null
        });

        await newIdea.save();
        await ctx.editMessageText(`🎉 Idea **"${stateData.name}"** successfully saved!`);
    } catch (err) {
        console.error('Save error:', err);
        if (err.code === 11000) {
            await ctx.editMessageText('❌ You already have an idea saved with this name.');
        } else {
            await ctx.editMessageText('❌ Error saving to database.');
        }
    }

    return ctx.scene.leave();
});

// Handle "Cancel" button click
ideaWizard.action('cancel_idea', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.editMessageText('❌ Idea submission cancelled.');
    return ctx.scene.leave();
});

export default ideaWizard;