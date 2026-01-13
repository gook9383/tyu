/**
 * SOLANA RADAR Twitter Bot
 * Posts about pumping coins with direct links to solanaradar.space?coin=ADDRESS
 */

const https = require('https');
const crypto = require('crypto');

const CONFIG = {
    SITE_URL: 'https://solanaradar.space',
    TWITTER_API_KEY: 'sA8TfoW6iaYTTgnA32A3g9kdS',
    TWITTER_API_SECRET: 'cJLcFxfkACFrZANlPsdIJvBuUn46mJwg5zkdz2KYxoBRJZ7An8',
    TWITTER_ACCESS_TOKEN: '1932548729891872768-rcIOIiUBJJVFWfXiUeqlP59SlG0nRj',
    TWITTER_ACCESS_SECRET: 'CtfiyZtjeQXFNQWqU4mYu7pbSwExl0yG4Q4ijwtxJoW26',
    POST_INTERVAL_MINUTES: 5,
    MIN_PUMP_PERCENT: 15,
    MIN_VOLUME: 10000,
    MIN_LIQUIDITY: 10000,
    MIN_SAFETY: 50,
    COOLDOWN_MINUTES: 60,
};

const DEX_API = 'https://api.dexscreener.com/latest/dex';
const SEARCHES = ['pump sol', 'meme solana', 'pepe sol', 'bonk', 'wif', 'popcat', 'degen sol', 'ai sol'];

async function fetchCoins() {
    const coins = new Map();
    for (const term of SEARCHES.slice(0, 5)) {
        try {
            const data = await httpGet(`${DEX_API}/search?q=${encodeURIComponent(term)}`);
            if (data.pairs) data.pairs.forEach(p => {
                if (p.chainId === 'solana' && p.baseToken?.address) {
                    const coin = processToken(p);
                    if (coin && !coins.has(coin.address)) coins.set(coin.address, coin);
                }
            });
        } catch (e) { console.error(`Error: ${e.message}`); }
        await sleep(500);
    }
    return Array.from(coins.values());
}

function processToken(pair) {
    const change5m = pair.priceChange?.m5 || 0, change1h = pair.priceChange?.h1 || 0;
    const volume = pair.volume?.h24 || 0, liquidity = pair.liquidity?.usd || 0;
    const txns = (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0);
    let safety = 50;
    if (liquidity > 50000) safety += 15; else if (liquidity > 20000) safety += 10; else if (liquidity < 5000) safety -= 15;
    if (txns > 500) safety += 10; else if (txns < 20) safety -= 10;
    if (volume > 50000) safety += 10;
    safety = Math.max(0, Math.min(100, safety));
    return { address: pair.baseToken.address, name: pair.baseToken.name || '?', symbol: pair.baseToken.symbol || '?', change5m, change1h, volume, liquidity, safety };
}

function createOAuthHeader(method, url) {
    const oauth = { oauth_consumer_key: CONFIG.TWITTER_API_KEY, oauth_nonce: crypto.randomBytes(16).toString('hex'), oauth_signature_method: 'HMAC-SHA1', oauth_timestamp: Math.floor(Date.now() / 1000).toString(), oauth_token: CONFIG.TWITTER_ACCESS_TOKEN, oauth_version: '1.0' };
    const sortedParams = Object.keys(oauth).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(oauth[k])}`).join('&');
    const signatureBase = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
    const signingKey = `${encodeURIComponent(CONFIG.TWITTER_API_SECRET)}&${encodeURIComponent(CONFIG.TWITTER_ACCESS_SECRET)}`;
    oauth.oauth_signature = crypto.createHmac('sha1', signingKey).update(signatureBase).digest('base64');
    return 'OAuth ' + Object.keys(oauth).sort().map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauth[k])}"`).join(', ');
}

async function postTweet(text) {
    const url = 'https://api.twitter.com/2/tweets', body = JSON.stringify({ text });
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method: 'POST', headers: { 'Authorization': createOAuthHeader('POST', url), 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
            let data = ''; res.on('data', c => data += c); res.on('end', () => { try { const j = JSON.parse(data); res.statusCode < 300 ? resolve(j) : reject(new Error(data)); } catch(e) { reject(e); } });
        });
        req.on('error', reject); req.write(body); req.end();
    });
}

function generateTweet(coin) {
    const coinUrl = `${CONFIG.SITE_URL}?coin=${coin.address}`;
    const templates = [
        `🚀 $${coin.symbol} PUMPING +${coin.change5m.toFixed(1)}%\n\n💰 Vol: ${formatVol(coin.volume)}\n🛡️ Safety: ${coin.safety}/100\n\nTrack live:\n${coinUrl}\n\n#Solana #Crypto`,
        `🔥 $${coin.symbol} Alert!\n\n📈 +${coin.change5m.toFixed(1)}% (5m)\n💧 Liq: ${formatVol(coin.liquidity)}\n\nView details:\n${coinUrl}\n\n#SOL #Memecoin`,
        `👀 $${coin.symbol} moving +${coin.change5m.toFixed(1)}%\n\nVol: ${formatVol(coin.volume)}\nSafety: ${coin.safety}/100\n\nCheck it:\n${coinUrl}\n\n#Solana`,
        `📡 RADAR: $${coin.symbol}\n\n+${coin.change5m.toFixed(1)}% pump\nVol: ${formatVol(coin.volume)}\n\nFull stats:\n${coinUrl}\n\n#Crypto #SOL`,
        `⚡ $${coin.symbol} +${coin.change5m.toFixed(1)}%\n\nSafety: ${coin.safety}/100\nVolume: ${formatVol(coin.volume)}\n\nLive:\n${coinUrl}\n\n#Solana #Degen`
    ];
    return templates[Math.floor(Math.random() * templates.length)];
}

function httpGet(url) { return new Promise((res, rej) => { https.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch(e) { rej(e); } }); }).on('error', rej); }); }
function formatVol(v) { if (!v) return '$0'; if (v >= 1e6) return `$${(v/1e6).toFixed(1)}M`; if (v >= 1e3) return `$${(v/1e3).toFixed(0)}K`; return `$${v.toFixed(0)}`; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const posted = new Map();
function canPost(c) { const t = posted.get(c.address); return !t || Date.now() - t > CONFIG.COOLDOWN_MINUTES * 60000; }
function markPosted(c) { posted.set(c.address, Date.now()); }

async function run() {
    console.log('========================================');
    console.log('📡 SOLANA RADAR Twitter Bot');
    console.log('========================================');
    console.log(`Site: ${CONFIG.SITE_URL}`);
    console.log(`Interval: ${CONFIG.POST_INTERVAL_MINUTES} minutes`);
    console.log(`Min pump: ${CONFIG.MIN_PUMP_PERCENT}%`);
    console.log('========================================\n');
    
    async function tick() {
        console.log(`[${new Date().toLocaleTimeString()}] Scanning for pumping coins...`);
        try {
            const coins = await fetchCoins();
            console.log(`Found ${coins.length} total coins`);
            
            const eligible = coins.filter(c => c.change5m >= CONFIG.MIN_PUMP_PERCENT && c.volume >= CONFIG.MIN_VOLUME && c.liquidity >= CONFIG.MIN_LIQUIDITY && c.safety >= CONFIG.MIN_SAFETY && canPost(c));
            console.log(`${eligible.length} eligible to post`);
            
            eligible.sort((a, b) => b.change5m - a.change5m);
            
            if (eligible.length > 0) {
                const coin = eligible[0];
                console.log(`\n🎯 Best coin: $${coin.symbol} +${coin.change5m.toFixed(1)}%`);
                
                const tweet = generateTweet(coin);
                console.log(`\n📝 Tweet:\n${tweet}\n`);
                
                const result = await postTweet(tweet);
                console.log(`✅ POSTED! Tweet ID: ${result.data?.id}`);
                console.log(`🔗 Direct link: ${CONFIG.SITE_URL}?coin=${coin.address}\n`);
                markPosted(coin);
            } else {
                console.log('No eligible coins right now\n');
            }
        } catch (e) { console.error(`❌ Error: ${e.message}\n`); }
    }
    
    // Run immediately
    await tick();
    
    // Then every 5 minutes
    setInterval(tick, CONFIG.POST_INTERVAL_MINUTES * 60000);
    console.log(`⏰ Next scan in ${CONFIG.POST_INTERVAL_MINUTES} minutes...\n`);
}

run();
