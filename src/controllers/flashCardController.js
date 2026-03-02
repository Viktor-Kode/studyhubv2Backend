import FlashCard from '../models/FlashCard.js';
import FlashCardDeck from '../models/FlashCardDeck.js';
import FlashCardSession from '../models/FlashCardSession.js';
import aiClient from '../utils/aiClient.js';
import { flashCardPrompt } from '../utils/prompts.js';
import { getModelById, MODEL_REGISTRY } from '../config/aiConfig.js';
import mongoose from 'mongoose';

// Create a new flashcard
export const createFlashCard = async (req, res) => {
    try {
        const userId = req.user._id;
        const {
            front,
            back,
            category,
            difficulty,
            tags,
            deckId
        } = req.body;

        if (!front || !back) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: front, back'
            });
        }

        const flashCard = new FlashCard({
            userId,
            front,
            back,
            category: category || 'General',
            difficulty: difficulty || 'medium',
            tags: tags || [],
            deckId
        });

        await flashCard.save();

        // Update deck card count if deck is specified and valid
        if (deckId && mongoose.Types.ObjectId.isValid(deckId)) {
            await FlashCardDeck.findOneAndUpdate(
                { _id: deckId, userId }, // Ensure deck belongs to user
                { $inc: { cardCount: 1 } }
            );
        }

        res.json({
            success: true,
            message: 'Flashcard created successfully',
            flashCard
        });

    } catch (error) {
        console.error('Create flashcard error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create flashcard'
        });
    }
};

// Get all flashcards joined with progress
export const getFlashCards = async (req, res) => {
    try {
        const studentId = req.user._id;
        const { category, deckId, favorite, search, shuffle, limit = 0 } = req.query;

        const match = { userId: studentId };

        if (category) match.category = category;
        if (deckId) match.deckId = new mongoose.Types.ObjectId(deckId);
        if (favorite === 'true') match.isFavorite = true;
        if (search) {
            match.$or = [
                { front: { $regex: search, $options: 'i' } },
                { back: { $regex: search, $options: 'i' } }
            ];
        }

        const pipeline = [
            { $match: match },
            {
                $lookup: {
                    from: 'flashcardprogresses',
                    let: { cardId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$cardId', '$$cardId'] },
                                        { $eq: ['$studentId', studentId] }
                                    ]
                                }
                            }
                        }
                    ],
                    as: 'progress'
                }
            },
            {
                $addFields: {
                    status: { $ifNull: [{ $arrayElemAt: ['$progress.status', 0] }, 'unseen'] },
                    nextReviewDate: { $arrayElemAt: ['$progress.nextReviewDate', 0] }
                }
            },
            { $limit: parseInt(limit) || 1000 }
        ];

        let result = await FlashCard.aggregate(pipeline);
        await FlashCard.populate(result, { path: 'deckId', select: 'name color icon' });

        res.json({
            success: true,
            count: result.length,
            flashCards: result
        });

    } catch (error) {
        console.error('Get flashcards error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch flashcards'
        });
    }
};

// Get cards due for review today
export const getDueCards = async (req, res) => {
    try {
        const studentId = new mongoose.Types.ObjectId(req.user._id);
        const { deckId, subject } = req.query;
        const now = new Date();

        const query = { studentId };
        if (deckId) query.deckId = deckId;
        if (subject) query.subject = subject;

        // Cards due for review (nextReviewDate <= now)
        const dueProgress = await FlashcardProgress.find({
            ...query,
            nextReviewDate: { $lte: now },
            status: { $ne: 'mastered' }
        }).lean();

        res.json({
            success: true,
            flashCards: dueProgress,
            count: dueProgress.length
        });

    } catch (error) {
        console.error('Get due cards error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch due cards'
        });
    }
};

// Update flashcard
export const updateFlashCard = async (req, res) => {
    try {
        const { cardId } = req.params;
        const userId = req.user._id;
        const updateData = req.body;

        const flashCard = await FlashCard.findOneAndUpdate(
            { _id: cardId, userId },
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!flashCard) {
            return res.status(404).json({
                success: false,
                message: 'Flashcard not found or access denied'
            });
        }

        res.json({
            success: true,
            message: 'Flashcard updated successfully',
            flashCard
        });

    } catch (error) {
        console.error('Update flashcard error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to update flashcard'
        });
    }
};

// Delete flashcard
export const deleteFlashCard = async (req, res) => {
    try {
        const { cardId } = req.params;
        const userId = req.user._id;

        const flashCard = await FlashCard.findOne({ _id: cardId, userId });

        if (!flashCard) {
            return res.status(404).json({
                success: false,
                message: 'Flashcard not found or access denied'
            });
        }

        // Update deck card count if card belongs to a deck
        if (flashCard.deckId) {
            await FlashCardDeck.findOneAndUpdate(
                { _id: flashCard.deckId, userId },
                { $inc: { cardCount: -1 } }
            );
        }

        await flashCard.deleteOne();

        res.json({
            success: true,
            message: 'Flashcard deleted successfully'
        });

    } catch (error) {
        console.error('Delete flashcard error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to delete flashcard'
        });
    }
};

/**
 * Review a card using SM-2 algorithm
 */
export const reviewCard = async (req, res) => {
    try {
        const { cardId, deckId, subject, topic, rating } = req.body;
        // rating: 1=Blackout/Wrong, 2=Hard, 3=Good, 4=Easy (Mapping 4 values from UI to SM-2)

        if (rating === undefined) {
            return res.status(400).json({ success: false, message: 'Rating is required' });
        }

        const studentId = req.user._id;
        let progress = await FlashcardProgress.findOne({ studentId, cardId, deckId });

        if (!progress) {
            progress = new FlashcardProgress({
                studentId, cardId, deckId, subject, topic
            });
        }

        // SM-2 Algorithm Implementation - Simplified for Mastered/Not Mastered
        if (rating >= 4) {
            // User selected "Mastered"
            progress.status = 'mastered';
            progress.intervalDays = 365; // Skip review for a year
            progress.correctStreak += 1;
            progress.easeFactor = Math.min(progress.easeFactor + 0.1, 5.0);
        } else {
            // User selected "Still Learning"
            progress.status = 'learning';
            progress.intervalDays = 1;
            progress.correctStreak = 0;
            progress.incorrectCount += 1;
            progress.easeFactor = Math.max(1.3, progress.easeFactor - 0.2);
        }

        // Schedule next review
        const nextDate = new Date();
        nextDate.setDate(nextDate.getDate() + progress.intervalDays);
        progress.nextReviewDate = nextDate;
        progress.reviewCount += 1;
        progress.confidence = q;
        progress.lastReviewed = new Date();

        await progress.save();
        await updateStreak(studentId, 'flashcard');

        res.json({
            success: true,
            status: progress.status,
            nextReview: progress.nextReviewDate,
            intervalDays: progress.intervalDays,
            correctStreak: progress.correctStreak
        });

    } catch (error) {
        console.error('Review card error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to review card'
        });
    }
};

// Toggle favorite
export const toggleFavorite = async (req, res) => {
    try {
        const { cardId } = req.params;
        const userId = req.user._id;

        const flashCard = await FlashCard.findOne({ _id: cardId, userId });

        if (!flashCard) {
            return res.status(404).json({
                success: false,
                message: 'Flashcard not found or access denied'
            });
        }

        flashCard.isFavorite = !flashCard.isFavorite;
        await flashCard.save();

        res.json({
            success: true,
            message: `Card ${flashCard.isFavorite ? 'added to' : 'removed from'} favorites`,
            flashCard
        });

    } catch (error) {
        console.error('Toggle favorite error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to toggle favorite'
        });
    }
};

// Decks
export const createDeck = async (req, res) => {
    try {
        const userId = req.user._id;
        const { name, description, category, tags, color, icon } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                message: 'Name is required'
            });
        }

        const deck = new FlashCardDeck({
            userId,
            name,
            description,
            category: category || 'General',
            tags: tags || [],
            color: color || '#3B82F6',
            icon: icon || '📚'
        });

        await deck.save();

        res.json({
            success: true,
            message: 'Deck created successfully',
            deck
        });

    } catch (error) {
        console.error('Create deck error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to create deck'
        });
    }
};

export const getDecks = async (req, res) => {
    try {
        const userId = req.user._id;
        const decks = await FlashCardDeck.find({ userId }).sort({ updatedAt: -1 });
        res.json({ success: true, count: decks.length, decks });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const updateDeck = async (req, res) => {
    try {
        const { deckId } = req.params;
        const userId = req.user._id;
        const updateData = req.body;

        const deck = await FlashCardDeck.findOneAndUpdate(
            { _id: deckId, userId },
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!deck) {
            return res.status(404).json({
                success: false,
                message: 'Deck not found or access denied'
            });
        }

        res.json({
            success: true,
            message: 'Deck updated successfully',
            deck
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const deleteDeck = async (req, res) => {
    try {
        const { deckId } = req.params;
        const userId = req.user._id;
        const { deleteCards } = req.query;

        const deck = await FlashCardDeck.findOne({ _id: deckId, userId });

        if (!deck) {
            return res.status(404).json({
                success: false,
                message: 'Deck not found or access denied'
            });
        }

        if (deleteCards === 'true') {
            await FlashCard.deleteMany({ deckId, userId });
        } else {
            await FlashCard.updateMany({ deckId, userId }, { $unset: { deckId: 1 } });
        }

        await deck.deleteOne();
        res.json({ success: true, message: 'Deck deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Updated stats using SM-2 Progress model
export const getFlashCardStats = async (req, res) => {
    try {
        const studentId = req.user._id;
        const studentObjectId = new mongoose.Types.ObjectId(studentId);

        // Get total cards count for this user
        const totalCards = await FlashCard.countDocuments({ userId: studentId });

        // Get category breakdown from BOTH models to ensure we see all cards
        const categoryBreakdown = await FlashCard.aggregate([
            { $match: { userId: studentObjectId } },
            {
                $group: {
                    _id: '$category',
                    count: { $sum: 1 }
                }
            },
            { $sort: { count: -1 } }
        ]);

        const stats = await FlashcardProgress.aggregate([
            { $match: { studentId: studentObjectId } },
            {
                $group: {
                    _id: null,
                    masteredCards: { $sum: { $cond: [{ $eq: ['$status', 'mastered'] }, 1, 0] } },
                    dueCards: {
                        $sum: {
                            $cond: [{
                                $and: [
                                    { $lte: ['$nextReviewDate', new Date()] },
                                    { $ne: ['$status', 'mastered'] }
                                ]
                            }, 1, 0]
                        }
                    },
                    totalReviews: { $sum: '$reviewCount' },
                    correctStreakAvg: { $avg: '$correctStreak' }
                }
            }
        ]);

        const difficultyBreakdown = await FlashCard.aggregate([
            { $match: { userId: studentObjectId } },
            {
                $group: {
                    _id: '$difficulty',
                    count: { $sum: 1 }
                }
            }
        ]);

        const result = stats[0] || {
            masteredCards: 0,
            dueCards: 0,
            totalReviews: 0,
            correctStreakAvg: 0
        };

        res.json({
            success: true,
            stats: {
                ...result,
                totalCards,
                categoryBreakdown,
                difficultyBreakdown,
                accuracy: totalCards > 0 ? Math.round((result.masteredCards / totalCards) * 100) : 0
            }
        });

    } catch (error) {
        console.error('Get flashcard stats error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch statistics'
        });
    }
};


// AI & Bulk
export const generateAIFlashCards = async (req, res) => {
    const userId = req.user._id;
    const { text, deckId, amount = 10, modelId, category } = req.body;

    if (!text || text.trim().length < 50) {
        return res.status(400).json({ success: false, message: 'Text too short' });
    }

    try {
        const selectedModel = modelId ? getModelById(modelId) : MODEL_REGISTRY.find(m => m.recommended);
        const response = await aiClient.chatCompletion({
            model: selectedModel.id,
            messages: [{ role: "user", content: flashCardPrompt(text, amount) }],
            max_tokens: 2000,
            temperature: 0.1,
        });

        const aiContent = response.choices[0].message.content;
        const startIdx = aiContent.indexOf('[');
        const endIdx = aiContent.lastIndexOf(']');
        let cleanJsonString = aiContent;
        if (startIdx !== -1 && endIdx !== -1) {
            cleanJsonString = aiContent.substring(startIdx, endIdx + 1);
        } else {
            cleanJsonString = aiContent.replace(/```json|```/g, "").trim();
        }

        const parsedCards = JSON.parse(cleanJsonString);
        const formattedCards = parsedCards.map((card) => ({
            userId,
            front: card.front,
            back: card.back,
            category: category || 'AI Generated',
            deckId
        }));

        const savedCards = await FlashCard.insertMany(formattedCards);

        if (deckId) {
            await FlashCardDeck.findOneAndUpdate({ _id: deckId, userId }, { $inc: { cardCount: savedCards.length } });
        }

        res.status(201).json({ success: true, count: savedCards.length, flashCards: savedCards });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const exportFlashCards = async (req, res) => {
    try {
        const userId = req.user._id;
        const { format = 'json', deckId } = req.query;

        const query = { userId };
        if (deckId) query.deckId = deckId;

        const cards = await FlashCard.find(query).lean();

        if (format === 'csv') {
            const fields = ['front', 'back', 'category', 'difficulty', 'tags'];
            const csv = [
                fields.join(','),
                ...cards.map(c => fields.map(f => `"${String(c[f] || '').replace(/"/g, '""')}"`).join(','))
            ].join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=flashcards.csv');
            return res.send(csv);
        }

        res.json({ success: true, count: cards.length, flashCards: cards });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const importFlashCards = async (req, res) => {
    try {
        const userId = req.user._id;
        const { flashCards, deckId } = req.body;

        if (!Array.isArray(flashCards)) {
            return res.status(400).json({ success: false, message: 'Invalid flashcards data' });
        }

        const formattedCards = flashCards.map(c => ({
            ...c,
            userId,
            deckId: deckId || c.deckId
        }));

        const savedCards = await FlashCard.insertMany(formattedCards);

        if (deckId) {
            await FlashCardDeck.findOneAndUpdate({ _id: deckId, userId }, { $inc: { cardCount: savedCards.length } });
        }

        res.status(201).json({ success: true, count: savedCards.length });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const saveStudySession = async (req, res) => {
    try {
        const userId = req.user._id;
        const { deckId, cardsStudied, correctAnswers, incorrectAnswers, duration, sessionType } = req.body;

        const session = new FlashCardSession({
            userId,
            deckId,
            cardsStudied,
            correctAnswers,
            incorrectAnswers,
            duration,
            sessionType: sessionType || 'study',
            completedAt: new Date()
        });

        await session.save();
        res.json({ success: true, session });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};


import FlashcardProgress from '../models/FlashcardProgress.js';
import { updateStreak } from '../utils/streakUtils.js';

export const updateFlashcardProgress = async (req, res) => {
    try {
        const { deckId, cardId, subject, status } = req.body;
        const studentId = req.user._id;

        await FlashcardProgress.findOneAndUpdate(
            { studentId, deckId, cardId },
            {
                $set: { status, subject: subject || 'General', lastReviewed: new Date() },
                $inc: {
                    seenCount: 1,
                    masteredCount: status === 'mastered' ? 1 : 0
                }
            },
            { upsert: true, new: true }
        );

        // Update streak
        await updateStreak(studentId, 'flashcard');

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
