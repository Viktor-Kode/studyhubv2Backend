import axios from 'axios';

const BASE_URL = 'https://ng-pastquestions-api.onrender.com';

const candidateSubjects = [
    'English Language', 'Mathematics', 'Physics', 'Chemistry', 'Biology',
    'Economics', 'Commerce', 'Accounting', 'Financial Accounting',
    'Government', 'History', 'Geography', 'Literature', 'Literature in English',
    'Christian Religious Knowledge', 'Islamic Religious Knowledge',
    'Civic Education', 'Insurance', 'Current Affairs', 'Agricultural Science',
    'Further Mathematics', 'Technical Drawing', 'Home Economics',
    'Food and Nutrition', 'Music', 'Fine Art', 'French', 'Hausa', 'Igbo', 'Yoruba',
    'Physical Education', 'Computer Studies', 'Data Processing',
    'Business Studies', 'Basic Technology', 'Social Studies',
    'General Mathematics', 'Applied Mathematics',
    'English', 'Maths', 'Lit', 'Agric', 'CRK', 'IRK',
];

async function probe() {
    const found = {};
    
    for (const sub of candidateSubjects) {
        try {
            const res = await axios.get(`${BASE_URL}/questions?subject=${encodeURIComponent(sub)}`, { timeout: 8000 });
            if (res.status === 200 && res.data.total > 0) {
                found[sub] = { total: res.data.total, apiYear: res.data.year };
                process.stdout.write(`✅ ${sub}: ${res.data.total} questions\n`);
            }
        } catch (err) {
            // Subject not found
        }
    }

    console.log('\n=== FOUND SUBJECTS ===');
    console.log(JSON.stringify(found, null, 2));
}

probe();
