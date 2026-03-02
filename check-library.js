async function check() {
    try {
        const res = await fetch('http://localhost:5000/api/debug/library');
        const data = await res.json();
        console.log(JSON.stringify(data, null, 2));
    } catch (e) {
        console.error('Fetch error:', e.message);
    }
}
check();
