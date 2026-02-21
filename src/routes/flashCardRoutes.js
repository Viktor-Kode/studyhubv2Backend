import express from 'express';
const router = express.Router();
import {
    createFlashCard,
    getFlashCards,
    getDueCards,
    updateFlashCard,
    deleteFlashCard,
    reviewCard,
    toggleFavorite,
    getFlashCardStats,
    createDeck,
    getDecks,
    updateDeck,
    deleteDeck,
    saveStudySession,
    generateAIFlashCards,
    importFlashCards,
    exportFlashCards,
    getPublicDecks,
    cloneDeck
} from '../controllers/flashCardController.js';

import { protect } from '../middleware/authMiddleware.js';

// Protect all routes
router.use(protect);

// Flashcard routes
router.post('/cards', createFlashCard);
router.post('/generate', generateAIFlashCards);
router.get('/cards/:userId', getFlashCards); // Keeping userId param for now but will validate in controller
router.get('/cards/:userId/due', getDueCards);
router.put('/cards/:cardId', updateFlashCard);
router.delete('/cards/:cardId', deleteFlashCard);
router.post('/cards/:cardId/review', reviewCard);
router.post('/cards/:cardId/favorite', toggleFavorite);
router.get('/stats/:userId', getFlashCardStats);
router.get('/export/:userId', exportFlashCards);
router.post('/import', importFlashCards);

// Deck routes
router.post('/decks', createDeck);
router.get('/public-decks', getPublicDecks); // Verify if checks public flag
router.post('/decks/:deckId/clone', cloneDeck);
router.get('/decks/:userId', getDecks);
router.put('/decks/:deckId', updateDeck);
router.delete('/decks/:deckId', deleteDeck);

// Session routes
router.post('/sessions', saveStudySession);

export default router;
