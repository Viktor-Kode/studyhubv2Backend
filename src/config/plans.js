// ─── Single Source of Truth for all plan configurations ───────────────────────
// price = kobo (for DB), amount = naira (for Flutterwave)
export const PLANS = {
    free: {
        name: 'Free',
        aiLimit: 5,
        flashcardLimit: 3,
        durationDays: null,
        price: 0,
        amount: 0,
        label: 'Free'
    },
    weekly: {
        name: 'Weekly',
        aiLimit: 80,
        flashcardLimit: 40,
        durationDays: 7,
        price: 60000, // kobo — ₦600
        amount: 600, // naira — what Flutterwave receives
        label: '₦600 / week'
    },
    monthly: {
        name: 'Monthly',
        aiLimit: 250,
        flashcardLimit: 120,
        durationDays: 30,
        price: 230000, // kobo — ₦2,300
        amount: 2300, // naira
        label: '₦2,300 / month'
    },
    addon: {
        name: 'AI Add-on',
        aiLimit: 100,
        flashcardLimit: 0,
        durationDays: 0, // no time extension
        price: 50000, // kobo — ₦500
        amount: 500, // naira
        label: '₦500 — 100 AI messages'
    }
};
