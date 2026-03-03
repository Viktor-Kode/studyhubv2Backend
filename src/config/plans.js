// ─── Single Source of Truth for all plan configurations ───────────────────────
export const PLANS = {
    free: {
        aiLimit: 5,
        flashcardLimit: 3,
        durationDays: null,
        price: 0,
        label: 'Free'
    },
    weekly: {
        aiLimit: 80,
        flashcardLimit: 40,
        durationDays: 7,
        price: 60000, // ₦600 in kobo
        label: 'Weekly — ₦600'
    },
    monthly: {
        aiLimit: 250,
        flashcardLimit: 120,
        durationDays: 30,
        price: 230000, // ₦2,300 in kobo
        label: 'Monthly — ₦2,300'
    },
    addon: {
        aiLimit: 100, // adds 100 on top of existing limit
        flashcardLimit: 0,
        durationDays: 0, // no duration extension
        price: 50000, // ₦500 in kobo
        label: 'AI Add-On — ₦500'
    }
};
