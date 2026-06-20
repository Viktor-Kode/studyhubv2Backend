import mongoose from 'mongoose';
import CBTResult from '../models/CBTResult.js';
import QuizSession from '../models/QuizSession.js';
import DocumentHash from '../models/DocumentHash.js';
import UserActivity from '../models/UserActivity.js';
import Question from '../models/Question.js';

/**
 * Migration service to resolve and clean up legacy 'General Study' subjects in CBTResult, 
 * matching QuizSession Questions, and corresponding UserActivity logs.
 */
export async function runSubjectMigration() {
    try {
        console.log('🔄 Checking for legacy generic CBT results to migrate...');
        
        // Match generic subjects like "General Study", "General studies", "general", "General"
        const genericRegex = /^(general study|general studies|general|study session|manual entry)$/i;
        
        // First: nuke any subjects that are clearly question text (contain '?')
        const questionTextResults = await CBTResult.find({ subject: { $regex: '\\?', $options: 'i' } });
        if (questionTextResults.length > 0) {
            console.log(`🔄 Found ${questionTextResults.length} CBT results with question-text subjects. Resetting to "Study Session"...`);
            await CBTResult.updateMany(
                { subject: { $regex: '\\?', $options: 'i' } },
                { $set: { subject: 'Study Session' } }
            );
            await Question.updateMany(
                { subject: { $regex: '\\?', $options: 'i' } },
                { $set: { subject: 'Study Session' } }
            );
            // Also update activity
            for (const r of questionTextResults) {
                await UserActivity.updateMany(
                    { userId: r.studentId, type: 'cbt_result', 'metadata.resultId': String(r._id) },
                    { $set: { title: 'Study Session practice completed', 'metadata.subject': 'Study Session' } }
                );
            }
            console.log(`✅ Reset question-text subjects to "Study Session".`);
        }

        // Find CBT results with generic subjects
        const resultsToMigrate = await CBTResult.find({
            subject: genericRegex
        });

        if (resultsToMigrate.length === 0) {
            console.log('✅ No legacy generic CBT results found. Migration skipped.');
            return;
        }

        console.log(`🔄 Found ${resultsToMigrate.length} legacy generic CBT results. Starting migration...`);
        let migratedCount = 0;

        for (const result of resultsToMigrate) {
            let resolvedSubject = null;

            // 1. Try resolving via DocumentHash if sessionId exists
            if (result.sessionId) {
                const docHash = await DocumentHash.findOne({
                    quizSessionIds: result.sessionId
                });
                
                if (docHash && docHash.fileName && docHash.fileName !== 'unknown' && docHash.fileName !== 'Manual Entry') {
                    resolvedSubject = docHash.fileName.replace(/\.[^/.]+$/, "").trim();
                    console.log(`📌 Resolved via DocumentHash: "${result.subject}" -> "${resolvedSubject}"`);
                }

                // 2. Try resolving via QuizSession title if still not resolved
                if (!resolvedSubject) {
                    const session = await QuizSession.findById(result.sessionId).populate('questions');
                    if (session && session.title) {
                        // Title format: "cleanSubject - Type Quiz - date"
                        const titleParts = session.title.split(' - ');
                        const possibleSubject = titleParts[0].trim();
                        if (possibleSubject && !genericRegex.test(possibleSubject) && possibleSubject !== 'Manual Entry') {
                            resolvedSubject = possibleSubject;
                            console.log(`📌 Resolved via QuizSession title: "${result.subject}" -> "${resolvedSubject}"`);
                        }

                        // 3. Try resolving via QuizSession's populated questions subject
                        if (!resolvedSubject && session.questions && session.questions.length > 0) {
                            for (const q of session.questions) {
                                if (q.subject && !genericRegex.test(q.subject) && q.subject !== 'Manual Entry') {
                                    resolvedSubject = q.subject;
                                    console.log(`📌 Resolved via QuizSession question subject: "${result.subject}" -> "${resolvedSubject}"`);
                                    break;
                                }
                            }
                        }
                    }
                }
            }

            // Discard any subject that looks like question text (contains '?' or is very long)
            if (resolvedSubject && (resolvedSubject.includes('?') || resolvedSubject.length > 80)) {
                console.log(`⚠️  Discarding question-text subject: "${resolvedSubject}"`);
                resolvedSubject = null;
            }

            // If a valid descriptive subject is resolved, apply the changes
            if (resolvedSubject && resolvedSubject.length > 0) {
                if (resolvedSubject.length > 60) {
                    resolvedSubject = resolvedSubject.substring(0, 57) + '...';
                }

                // Update CBTResult
                result.subject = resolvedSubject;
                await result.save();

                // Update any associated questions in the sessionId if they still have the generic subject
                if (result.sessionId) {
                    try {
                        const session = await QuizSession.findById(result.sessionId);
                        if (session && session.questions) {
                            await Question.updateMany(
                                { _id: { $in: session.questions }, subject: genericRegex },
                                { $set: { subject: resolvedSubject } }
                            );
                        }
                    } catch (e) {
                        console.error(`Failed to update questions subject for session ${result.sessionId}:`, e.message);
                    }
                }

                // Update UserActivity logs
                await UserActivity.updateMany(
                    {
                        userId: result.studentId,
                        type: 'cbt_result',
                        'metadata.resultId': String(result._id)
                    },
                    {
                        $set: {
                            title: `${resolvedSubject} practice completed`,
                            'metadata.subject': resolvedSubject
                        }
                    }
                );

                migratedCount++;
            }
        }

        console.log(`✅ Migration complete. Successfully migrated ${migratedCount}/${resultsToMigrate.length} legacy results.`);
    } catch (error) {
        console.error('❌ Legacy subject migration failed:', error);
    }
}
