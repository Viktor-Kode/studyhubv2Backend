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

// Get all flashcards for a user
export const getFlashCards = async (req, res) => {
    try {
        const userId = req.user._id;
        const { category, deckId, favorite, search, shuffle, limit = 0 } = req.query;

        const query = { userId };

        if (category) {
            query.category = category;
        }

        if (deckId) {
            query.deckId = deckId;
        }

        if (favorite === 'true') {
            query.isFavorite = true;
        }

        if (search) {
            query.$or = [
                { front: { $regex: search, $options: 'i' } },
                { back: { $regex: search, $options: 'i' } }
            ];
        }

        let flashCards;
        if (shuffle === 'true') {
            flashCards = await FlashCard.aggregate([
                { $match: query },
                { $sample: { size: parseInt(limit) || 100 } }
            ]);
            // Populate deck manually for aggregate
            flashCards = await FlashCard.populate(flashCards, { path: 'deckId', select: 'name color icon' });
        } else {
            flashCards = await FlashCard.find(query)
                .populate('deckId', 'name color icon')
                .sort({ createdAt: -1 })
                .limit(parseInt(limit) || 0);
        }

        res.json({
            success: true,
            count: flashCards.length,
            flashCards
        });

    } catch (error) {
        console.error('Get flashcards error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to fetch flashcards'
        });
    }
};

// Get cards due for review (Spaced Repetition)
export const getDueCards = async (req, res) => {
    try {
        const userId = req.user._id;
        const now = new Date();

        const dueCards = await FlashCard.find({
            userId,
            $or: [
                { nextReviewDate: { $lte: now } },
                { nextReviewDate: { $exists: false } }
            ]
        })
            .populate('deckId', 'name color icon')
            .sort({ nextReviewDate: 1 })
            .limit(50);

        res.json({
            success: true,
            count: dueCards.length,
            flashCards: dueCards
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

// Review a card (Spaced Repetition Algorithm)
export const reviewCard = async (req, res) => {
    try {
        const { cardId } = req.params;
        const { wasCorrect } = req.body;
        const userId = req.user._id;

        if (!cardId) {
            return res.status(400).json({
                success: false,
                message: 'Card ID is required'
            });
        }

        const flashCard = await FlashCard.findOne({ _id: cardId, userId });

        if (!flashCard) {
            return res.status(404).json({
                success: false,
                message: 'Flashcard not found or access denied'
            });
        }

        // Update review stats
        flashCard.reviewCount = (flashCard.reviewCount || 0) + 1;
        flashCard.lastReviewed = new Date();

        if (wasCorrect) {
            flashCard.correctCount = (flashCard.correctCount || 0) + 1;
            flashCard.masteryLevel = Math.min(5, (flashCard.masteryLevel || 0) + 1);
        } else {
            flashCard.incorrectCount = (flashCard.incorrectCount || 0) + 1;
            flashCard.masteryLevel = Math.max(0, (flashCard.masteryLevel || 0) - 1);
        }

        // Spaced repetition intervals in days
        const intervals = [1, 3, 7, 14, 30];
        const intervalDays = intervals[flashCard.masteryLevel] || 30;

        const nextReview = new Date();
        nextReview.setDate(nextReview.getDate() + intervalDays);
        flashCard.nextReviewDate = nextReview;

        await flashCard.save();

        res.json({
            success: true,
            message: wasCorrect ? 'Great job! Card mastery increased.' : 'Keep practicing! Card scheduled for sooner review.',
            flashCard,
            nextReviewIn: intervalDays
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

// Stats with safe aggregate
export const getFlashCardStats = async (req, res) => {
    try {
        const userId = req.user._id;
        const userObjectId = new mongoose.Types.ObjectId(userId);

        const totalCards = await FlashCard.countDocuments({ userId });
        const masteredCards = await FlashCard.countDocuments({
            userId,
            masteryLevel: 5
        });
        const dueCards = await FlashCard.countDocuments({
            userId,
            $or: [
                { nextReviewDate: { $lte: new Date() } },
                { nextReviewDate: { $exists: false } }
            ]
        });

        const categoryBreakdown = await FlashCard.aggregate([
            { $match: { userId: userObjectId } },
            {
                $group: {
                    _id: '$category',
                    count: { $sum: 1 },
                    avgMastery: { $avg: '$masteryLevel' }
                }
            },
            { $sort: { count: -1 } }
        ]);

        const difficultyBreakdown = await FlashCard.aggregate([
            { $match: { userId: userObjectId } },
            {
                $group: {
                    _id: '$difficulty',
                    count: { $sum: 1 }
                }
            }
        ]);

        const recentSessions = await FlashCardSession.find({ userId })
            .sort({ createdAt: -1 })
            .limit(10);

        const totalReviews = await FlashCard.aggregate([
            { $match: { userId: userObjectId } },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$reviewCount' },
                    correct: { $sum: '$correctCount' },
                    incorrect: { $sum: '$incorrectCount' }
                }
            }
        ]);

        const totalRevCount = totalReviews.length > 0 ? (totalReviews[0].correct + totalReviews[0].incorrect) : 0;
        const accuracy = totalRevCount > 0
            ? Math.round((totalReviews[0].correct / totalRevCount) * 100)
            : 0;

        res.json({
            success: true,
            stats: {
                totalCards,
                masteredCards,
                dueCards,
                categoryBreakdown,
                difficultyBreakdown,
                accuracy,
                totalReviews: totalReviews.length > 0 ? totalReviews[0].total : 0,
                recentSessions
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

export const getPublicDecks = async (req, res) => {
    try {
        const { category, search } = req.query;
        const query = { isPublic: true };
        if (category) query.category = category;
        if (search) {
            query.$or = [{ name: { $regex: search, $options: 'i' } }, { description: { $regex: search, $options: 'i' } }];
        }
        const decks = await FlashCardDeck.find(query).sort({ updatedAt: -1 });
        res.json({ success: true, count: decks.length, decks });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

export const cloneDeck = async (req, res) => {
    try {
        const { deckId } = req.params;
        const userId = req.user._id;

        const originalDeck = await FlashCardDeck.findById(deckId);
        if (!originalDeck) return res.status(404).json({ success: false, message: 'Deck not found' });

        const newDeck = new FlashCardDeck({
            userId,
            name: `${originalDeck.name} (Clone)`,
            description: originalDeck.description,
            category: originalDeck.category,
            color: originalDeck.color,
            icon: originalDeck.icon,
            isPublic: false
        });

        await newDeck.save();

        const originalCards = await FlashCard.find({ deckId });
        const newCards = originalCards.map(c => ({
            userId,
            deckId: newDeck._id,
            front: c.front,
            back: c.back,
            category: c.category,
            difficulty: c.difficulty,
            tags: c.tags
        }));

        if (newCards.length > 0) {
            await FlashCard.insertMany(newCards);
            newDeck.cardCount = newCards.length;
            await newDeck.save();
        }

        res.status(201).json({ success: true, deck: newDeck });
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
