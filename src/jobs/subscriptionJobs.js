import cron from 'node-cron';
import User from '../models/User.js';
import { sendPlanExpiryWarning } from '../services/termiiService.js';

// Runs every day at midnight Nigeria time
cron.schedule('0 0 * * *', async () => {
    console.log('🔄 Running subscription expiry check...');
    try {
        const now = new Date();

        // Find all expired active subscriptions
        const expired = await User.find({
            subscriptionStatus: 'active',
            subscriptionEnd: { $lt: now }
        });

        console.log(`Found ${expired.length} expired subscriptions`);

        for (const user of expired) {
            await User.findByIdAndUpdate(user._id, {
                subscriptionStatus: 'expired',
                subscriptionPlan: null,
                // Reset to free limits
                aiUsageCount: 0,
                aiUsageLimit: 5,
                flashcardUsageCount: 0,
                flashcardUsageLimit: 3
            });

            console.log(`❌ Expired: ${user.email}`);

            // Notify user via WhatsApp
            if (user.phoneNumber) {
                await sendPlanExpiryWarning(user.phoneNumber, {
                    planName: user.subscriptionPlan,
                    daysLeft: 0
                });
            }
        }

        console.log('✅ Expiry check complete');
    } catch (err) {
        console.error('❌ Expiry job error:', err.message);
    }
}, { timezone: 'Africa/Lagos' });

