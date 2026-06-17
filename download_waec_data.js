import fs from 'fs';
import axios from 'axios';

const outputDir = 'C:/Users/User/.gemini/antigravity-ide/brain/e5694c19-694b-4a72-bbd1-188a02eabef5/scratch/waec_cache';
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

const subjectsConfig = [
    { key: 'English Language', apiName: 'English Language', years: ['2023', '2022', '2021', '2020', '2019', '2018', '2017', '2016', '2015'] },
    { key: 'Government', apiName: 'Government', years: ['2023', '2022', '2021', '2020', '2019', '2018', '2017', '2016', '2015'] },
    { key: 'economics', apiName: 'Economics', years: ['2023', '2022', '2021', '2020', '2019', '2018', '2017', '2016', '2015'] },
    { key: 'Mathematics', apiName: 'Mathematics', years: ['2023', '2022', '2021', '2020'] }
];

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchWithRetry(subject, year) {
    const url = `https://ng-pastquestions-api.onrender.com/questions?subject=${encodeURIComponent(subject)}&year=${year}`;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            console.log(`Fetching: ${subject} (${year}) - Attempt ${attempt}...`);
            const res = await axios.get(url, { timeout: 20000 });
            return res.data;
        } catch (error) {
            const status = error.response?.status;
            console.warn(`Failed: ${subject} (${year}) - Status ${status || 'unknown'}: ${error.message}`);
            if (status === 429) {
                console.log('Rate limit hit. Sleeping for 8 seconds...');
                await sleep(8000);
            } else {
                await sleep(2000);
            }
        }
    }
    return null;
}

async function main() {
    const data = {
        exams: {
            waec: {
                subjects: {}
            }
        },
        metadata: {
            availableExams: ['waec'],
            subjects: subjectsConfig.map(s => s.key),
            yearsBySubject: {}
        }
    };

    for (const sub of subjectsConfig) {
        data.exams.waec.subjects[sub.key] = { years: {} };
        data.metadata.yearsBySubject[sub.key] = sub.years;

        for (const year of sub.years) {
            const cacheFile = `${outputDir}/${sub.key.replace(/ /g, '_')}_${year}.json`;
            let yearData = null;

            if (fs.existsSync(cacheFile)) {
                try {
                    yearData = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
                    console.log(`Loaded from local scratch cache: ${sub.key} (${year})`);
                } catch (e) {
                    console.error(`Cache corrupt for ${sub.key} (${year}):`, e.message);
                }
            }

            if (!yearData) {
                // Fetch from PQ API
                const apiData = await fetchWithRetry(sub.apiName, year);
                if (apiData && apiData.questions && apiData.questions.length > 0) {
                    yearData = apiData;
                    fs.writeFileSync(cacheFile, JSON.stringify(yearData, null, 2));
                    console.log(`Saved to scratch cache: ${sub.key} (${year})`);
                } else {
                    console.error(`❌ Could not fetch questions for ${sub.key} (${year})`);
                }
                // Sleep between requests to respect rate limits
                await sleep(3000);
            }

            if (yearData && yearData.questions) {
                const uniqueTopics = [...new Set(yearData.questions.map(q => q.topic).filter(Boolean))];
                
                // Map questions to match frontend format requirements
                const mappedQuestions = yearData.questions.map(q => {
                    const mapped = {
                        no: q.no || q.id || 1,
                        topic: q.topic || 'General',
                        question: q.question || '',
                        options: {
                            A: q.options?.A || q.options?.a || '',
                            B: q.options?.B || q.options?.b || '',
                            C: q.options?.C || q.options?.c || '',
                            D: q.options?.D || q.options?.d || ''
                        },
                        answer: String(q.answer || 'A').toUpperCase(),
                        explanation: q.explanation || q.solution || ''
                    };
                    if (q.tested_word) mapped.tested_word = q.tested_word;
                    if (q.image || q.diagram) {
                        mapped.diagram = {
                            image_url: q.image || q.diagram || '',
                            description: q.diagram_desc || 'Question diagram'
                        };
                    }
                    return mapped;
                });

                data.exams.waec.subjects[sub.key].years[year] = {
                    total_questions: mappedQuestions.length,
                    topics: uniqueTopics,
                    questions: mappedQuestions
                };
            }
        }
    }

    const finalPath = 'c:/Users/User/OneDrive/Desktop/studyhelpV2/studyhelpFrontend/lib/data/waecExamData.json';
    fs.writeFileSync(finalPath, JSON.stringify(data, null, 2));
    console.log(`\n🎉 Completed! Written unified WAEC data to ${finalPath}`);
}

main().catch(console.error);
