export const PLANS = {
    free: {
        testsAllowed: 1,
        aiExplanationsAllowed: 5,
        allSubjects: false,
        subjectsAllowed: ['english'],
        price: 0,
        label: 'Free'
    },
    starter: {
        testsAllowed: 5,
        aiExplanationsAllowed: 10,
        allSubjects: false,
        subjectsAllowed: ['english'],  // 1 subject
        price: 50000,   // ₦500 in kobo for Paystack
        label: 'Starter – ₦500'
    },
    growth: {
        testsAllowed: 20,
        aiExplanationsAllowed: 50,
        allSubjects: true,
        subjectsAllowed: [],
        price: 150000,  // ₦1,500 in kobo
        label: 'Growth – ₦1,500'
    },
    premium: {
        testsAllowed: 60,
        aiExplanationsAllowed: 200,
        allSubjects: true,
        subjectsAllowed: [],
        price: 300000,  // ₦3,000 in kobo
        label: 'Premium – ₦3,000'
    }
};
