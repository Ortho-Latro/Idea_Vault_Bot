import fs from 'fs';
import { Scenes, Markup } from 'telegraf';
import { v4 as uuidv4 } from 'uuid';
import { downloadTelegramFile } from '../services/storage.js';
import Idea from '../models/Idea.js';

const WIZARD_ID = 'idea-submission-wizard';

// Step cursors (0-based) – keep in sync with the handler order below
const STEP_VIDEO = 3;
const STEP_REVIEW = 4;

const MAX_NAME_LENGTH = 100;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024; // Telegram Bot API getFile limit
const SUMMARY_DESCRIPTION_PREVIEW = 500;

// Escape user-provided text for Telegram's HTML parse mode
const escapeHtml = (value = '') =>
    String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const truncate = (text = '', max) => (text.length > max ? `${text.slice(0, max)}…` : text);

const skipVideoKeyboard = () =>
    Markup.inlineKeyboard([Markup.button.callback('Skip Video', 'skip_video')]);

const reviewKeyboard = () =>
    Markup.inlineKeyboard([
        [Markup.button.callback('✅ Save Idea', 'save_idea')],
        [Markup.button.callback('❌ Cancel', 'cancel_idea')]
    ]);

const buildSummary = (data) =>
    `📋 <b>Idea Review Summary</b>\n\n` +
    `• <b>Name:</b> ${escapeHtml(data.name)}\n` +
    `• <b>Description:</b> ${escapeHtml(truncate(data.description, SUMMARY_DESCRIPTION_PREVIEW))}\n` +
    `• <b>Video:</b> ${data.video ? 'Attached' : 'None'}`;

// Returns trimmed text if the update is a plain text message, otherwise null
const getText = (ctx) => {
    const text = ctx.message?.text;
    return typeof text === 'string' && text.trim() ? text.trim() : null;
};

// Stale inline buttons (from old messages) must still be acknowledged so Telegram stops the spinner
const handleStaleCallback = async (ctx) => {
    if (!ctx.callbackQuery) return false;
    await ctx.answerCbQuery('That button is no longer active.').catch(() => {});
    return true;
};

// Remove a downloaded video that will never be saved (cancel / duplicate / abandoned)
const discardVideoFile = (data) => {
    const localPath = data?.video?.localPath;
    if (localPath) {
        fs.unlink(localPath, () => {});
    }
};

// Shared validation for the text-only steps. Returns the text, or null after sending feedback.
const requireText = async (ctx, fieldLabel) => {
    if (await handleStaleCallback(ctx)) return null;

    const text = getText(ctx);

    if (!text) {
        await ctx.reply(
            `⚠️ I can only accept <b>text</b> for the ${fieldLabel} (stickers, photos, voice notes and files aren't supported here).\n\n` +
            `Please type the ${fieldLabel} and send it again, or send /cancel to stop.`,
            { parse_mode: 'HTML' }
        );
        return null;
    }

    if (text.startsWith('/')) {
        await ctx.reply(
            `⚠️ That looks like a command. Please type the ${fieldLabel} as plain text, or send /cancel to stop.`
        );
        return null;
    }

    return text;
};

const ideaWizard = new Scenes.WizardScene(
    WIZARD_ID,

    // Step 1: Prompt for Idea Name
    async (ctx) => {
        ctx.wizard.state.ideaData = {};
        await ctx.reply(
            '💡 Let\'s store a new idea.\n\nFirst, what is the <b>name</b> of your idea?\n(Send /cancel at any time to stop.)',
            { parse_mode: 'HTML' }
        );
        return ctx.wizard.next();
    },

    // Step 2: Capture Name, Prompt for Description
    async (ctx) => {
        const name = await requireText(ctx, 'name');
        if (!name) return; // stay on this step so the user can retry

        if (name.length > MAX_NAME_LENGTH) {
            await ctx.reply(`⚠️ That name is too long (${name.length} characters). Please keep it under ${MAX_NAME_LENGTH}.`);
            return;
        }

        ctx.wizard.state.ideaData.name = name;
        await ctx.reply(
            `Got it: <b>${escapeHtml(name)}</b>.\n\nNow, provide a <b>description</b> or paste your notes:`,
            { parse_mode: 'HTML' }
        );
        return ctx.wizard.next();
    },

    // Step 3: Capture Description, Prompt for Video
    async (ctx) => {
        const description = await requireText(ctx, 'description');
        if (!description) return; // stay on this step so the user can retry

        ctx.wizard.state.ideaData.description = description;
        ctx.wizard.state.ideaData.extractedText = description;

        await ctx.reply(
            '🎬 Upload a <b>video</b> explaining your idea, or click "Skip Video".',
            { parse_mode: 'HTML', ...skipVideoKeyboard() }
        );
        return ctx.wizard.next();
    },

    // Step 4: Handle Video Upload (wait for a video or the skip button)
    async (ctx) => {
        if (await handleStaleCallback(ctx)) return;

        const stateData = ctx.wizard.state.ideaData;
        const video = ctx.message?.video;

        // Anything other than a video (text, sticker, photo, ...) is rejected without advancing
        if (!video) {
            await ctx.reply(
                '⚠️ Please send a <b>video</b> (as a video, not a file), or tap "Skip Video". Send /cancel to stop.',
                { parse_mode: 'HTML', ...skipVideoKeyboard() }
            );
            return;
        }

        if (video.file_size && video.file_size > MAX_VIDEO_BYTES) {
            await ctx.reply(
                '⚠️ That video is larger than 20 MB, which is the most I can download. Send a smaller one or tap "Skip Video".',
                skipVideoKeyboard()
            );
            return;
        }

        await ctx.reply('Processing video file...');

        try {
            const fileLink = await ctx.telegram.getFileLink(video.file_id);
            const savedFile = await downloadTelegramFile(fileLink.href, '.mp4');

            stateData.video = {
                fileId: video.file_id,
                storageUrl: savedFile.storageUrl,
                mimeType: video.mime_type || 'video/mp4',
                sizeBytes: video.file_size || 0,
                localPath: savedFile.localPath // used only for cleanup; never saved to the database
            };
        } catch (err) {
            console.error('Video error:', err);
            await ctx.reply(
                '❌ I couldn\'t process that video. Try sending it again, or tap "Skip Video".',
                skipVideoKeyboard()
            );
            return;
        }

        await ctx.reply(buildSummary(stateData), { parse_mode: 'HTML', ...reviewKeyboard() });
        return ctx.wizard.next();
    },

    // Step 5: Review step – only the inline buttons are valid here
    async (ctx) => {
        if (await handleStaleCallback(ctx)) return;

        await ctx.reply(
            'Please use the buttons on the summary above to <b>Save</b> or <b>Cancel</b> this idea (or send /cancel).',
            { parse_mode: 'HTML' }
        );
    }
);

// --- Scene-level handlers (run before the step handlers) ---

ideaWizard.command('cancel', async (ctx) => {
    discardVideoFile(ctx.wizard.state.ideaData);
    await ctx.reply('❌ Idea submission cancelled.');
    return ctx.scene.leave();
});

// "Skip Video" button (only valid while waiting for the video)
ideaWizard.action('skip_video', async (ctx) => {
    const stateData = ctx.wizard.state.ideaData;

    if (ctx.wizard.cursor !== STEP_VIDEO || !stateData?.name || !stateData?.description) {
        return ctx.answerCbQuery('That button is no longer active.').catch(() => {});
    }

    await ctx.answerCbQuery();
    stateData.video = null;

    await ctx.editMessageText(buildSummary(stateData), { parse_mode: 'HTML', ...reviewKeyboard() });

    return ctx.wizard.selectStep(STEP_REVIEW);
});

// "Save Idea" button (only valid on the review step)
ideaWizard.action('save_idea', async (ctx) => {
    const stateData = ctx.wizard.state.ideaData;

    if (ctx.wizard.cursor !== STEP_REVIEW || !stateData?.name || !stateData?.description) {
        return ctx.answerCbQuery('That button is no longer active.').catch(() => {});
    }

    await ctx.answerCbQuery();

    try {
        const payload = {
            IdeaId: uuidv4(),
            telegramId: ctx.from.id.toString(),
            name: stateData.name,
            description: stateData.description,
            extractedText: stateData.extractedText || ''
        };

        if (stateData.video) {
            const { fileId, storageUrl, mimeType, sizeBytes } = stateData.video;
            payload.video = { fileId, storageUrl, mimeType, sizeBytes };
        }

        await new Idea(payload).save();
        await ctx.editMessageText(
            `🎉 Idea <b>"${escapeHtml(stateData.name)}"</b> successfully saved!`,
            { parse_mode: 'HTML' }
        );
    } catch (err) {
        console.error('Save error:', err);

        if (err.code === 11000) {
            discardVideoFile(stateData);
            await ctx.editMessageText('❌ You already have an idea saved with this name. Use /newidea to try again with a different name.');
            return ctx.scene.leave();
        }

        // Keep the wizard (and the buttons) alive so the user can retry without re-entering everything
        await ctx.reply('❌ Error saving to database. Tap "Save Idea" to try again, or "Cancel".');
        return;
    }

    return ctx.scene.leave();
});

// "Cancel" button
ideaWizard.action('cancel_idea', async (ctx) => {
    await ctx.answerCbQuery();
    discardVideoFile(ctx.wizard.state.ideaData);
    await ctx.editMessageText('❌ Idea submission cancelled.');
    return ctx.scene.leave();
});

export default ideaWizard;