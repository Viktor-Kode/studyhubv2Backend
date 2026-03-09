// ─── Single Source of Truth for all plan configurations ───────────────────────
// price = kobo (for DB), amount = naira (for Flutterwave)
export const PLANS = {
    free: {
        name: 'Free',
        aiLimit: 10,
        flashcardLimit: 5,
        durationDays: null,
        price: 0,
        amount: 0,
        label: 'Free forever',
        features: [
            '10 AI-generated questions',
            '3 CBT practice tests',
            '5 flashcard reviews',
            'Basic study timer',
            'Limited analytics'
        ],
        notIncluded: [
            'Unlimited CBT tests',
            'Post-UTME practice',
            'AI explanations',
            'Notes & highlights',
            'Streak tracking'
        ]
    },
    weekly: {
        name: 'Weekly',
        aiLimit: 80,
        flashcardLimit: 40,
        durationDays: 7,
        price: 60000, // kobo — ₦600
        amount: 600, // naira
        label: '₦600 / week',
        features: [
            '80 AI-generated questions',
            'Unlimited CBT tests',
            '40 flashcard reviews',
            'All exam types (JAMB, WAEC, Post-UTME)',
            'Smart study timer',
            'Full analytics & progress tracking',
            'Notes & highlights',
            'Streak tracking',
            'AI explanations for answers'
        ],
        notIncluded: []
    },
    monthly: {
        name: 'Monthly',
        aiLimit: 250,
        flashcardLimit: 120,
        durationDays: 30,
        price: 230000, // kobo — ₦2,300
        amount: 2300, // naira
        label: '₦2,300 / month',
        badge: 'Best Value',
        savings: 'Save ₦1,100 vs weekly',
        features: [
            '250 AI-generated questions',
            'Unlimited CBT tests',
            '120 flashcard reviews',
            'All exam types (JAMB, WAEC, Post-UTME)',
            'Smart study timer',
            'Full analytics & progress tracking',
            'Notes & highlights',
            'Streak tracking',
            'AI explanations for answers',
            'Priority support'
        ],
        notIncluded: []
    },
    addon: {
        name: 'AI Add-on',
        aiLimit: 100,
        flashcardLimit: 0,
        durationDays: 0,
        price: 50000, // kobo — ₦500
        amount: 500, // naira
        label: '₦500 one-time',
        features: [
            '100 extra AI-generated questions',
            'Added to your current plan',
            'Never expires'
        ]
    }
};
