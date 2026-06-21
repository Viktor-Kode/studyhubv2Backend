// ─── Single Source of Truth for all plan configurations ───────────────────────
// price = kobo (for DB), amount = naira (for Flutterwave)
export const PLANS = {
    free: {
        name: 'Free',
        aiLimit: 999999,
        flashcardLimit: 999999,
        durationDays: null,
        price: 0,
        amount: 0,
        label: 'Free forever',
        features: [
            '3 practice sessions (10 questions each)',
            'Basic study timer',
            'Limited analytics'
        ],
        notIncluded: [
            'Unlimited CBT practice',
            'Post-UTME practice',
            'Notes & highlights',
            'Streak tracking'
        ]
    },
    daily: {
        name: 'Daily',
        aiLimit: 999999,
        flashcardLimit: 999999,
        durationDays: 1,
        price: 0,
        amount: 0,
        label: '1-day pass',
        features: [
            'Unlimited AI questions & tutoring',
            'Unlimited CBT tests',
            'All exam types (JAMB, WAEC, Post-UTME)',
            'Full analytics & progress tracking',
            'AI explanations for answers'
        ],
        notIncluded: []
    },
    weekly: {
        name: 'Weekly',
        aiLimit: 999999,
        flashcardLimit: 999999,
        durationDays: 7,
        price: 100000, // kobo — ₦1,000
        amount: 1000, // naira
        label: '₦1,000 / week',
        features: [
            'Unlimited CBT tests & study sessions',
            'Unlimited AI questions & tutoring',
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
        aiLimit: 999999,
        flashcardLimit: 999999,
        durationDays: 30,
        price: 350000, // kobo — ₦3,500
        amount: 3500, // naira
        label: '₦3,500 / month',
        badge: 'Best Value',
        savings: 'Save ₦500 vs weekly',
        features: [
            'Unlimited CBT tests & study sessions',
            'Unlimited AI questions & tutoring',
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
    yearly: {
        name: 'Yearly',
        aiLimit: 999999,
        flashcardLimit: 999999,
        durationDays: 365,
        price: 2999000, // kobo — ₦29,990
        amount: 29990, // naira
        label: '₦29,990 / year',
        badge: 'Best Savings',
        savings: 'Save 30% vs monthly',
        features: [
            'Unlimited CBT tests & study sessions',
            'Unlimited AI questions & tutoring',
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
        aiLimit: 60,
        flashcardLimit: 0,
        durationDays: 5,
        price: 50000, // kobo — ₦500
        amount: 500, // naira
        label: '₦500 one-time',
        features: [
            '60 extra AI-generated questions',
            'Added to your current plan',
            'Expires in 5 days'
        ]
    }
};

// ─── Teacher Plans (separate from student plans) ─────────────────────────────
export const TEACHER_PLANS = {
    free: {
        name: 'Teacher Free',
        usagePerFeature: 3,
        features: ['question_generator', 'lesson_note', 'result_compiler',
            'report_card', 'report_comment', 'scheme_of_work', 'marking_scheme',
            'differentiated', 'comprehension', 'class_record', 'diary']
    },
    weekly: {
        name: 'Teacher Weekly',
        price: 1500,
        amount: 1500,
        durationDays: 7,
        usagePerFeature: 999,
        label: '₦1,500 / week'
    },
    monthly: {
        name: 'Teacher Monthly',
        price: 3500,
        amount: 3500,
        durationDays: 30,
        usagePerFeature: 999,
        label: '₦3,500 / month',
        badge: 'Best Value'
    }
};
