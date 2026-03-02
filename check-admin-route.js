async function check(path) {
    console.log(`Checking ${path}...`);
    try {
        const res = await fetch(`http://localhost:5000${path}`, { method: 'POST' });
        console.log(`Status: ${res.status}`);
        const data = await res.json();
        console.log(JSON.stringify(data, null, 2).substring(0, 500));
    } catch (e) {
        console.error(`Fetch error for ${path}:`, e.message);
    }
}

run();
async function run() {
    await check('/api/admin/guides/seed-starter');
}
