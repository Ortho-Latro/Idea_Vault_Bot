import mongoose from 'mongoose';

const IdeaSchema = new mongoose.Schema({
    IdeaId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    telegramId: {
        type: String,
        required: true,
        index: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        required: true
    },
    extractedText: {
        type: String,
        default: ''
    },
    video: {
        fileId: { type: String },
        storageUrl: { type: String },
        mimeType: { type: String },
        sizeBytes: { type: Number }
    }
}, {timestamps: true });

IdeaSchema.index({ telegramId: 1, name: 1 }, {unique: true});

export default mongoose.model('Idea', IdeaSchema);