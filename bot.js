/**
 * SOLANA RADAR Twitter Bot
 * Finds coins by PERFORMANCE DATA, not names
 * Posts about pumping coins with direct links to solanaradar.space
 */

const https = require('https');
const crypto = require('crypto');

const CONFIG = {
    SITE_URL: 'https://solanaradar.space',
    TWITTER_API_KEY: 'Yi8BOKJ8mC7jyAo2XjC1AXwQc',
    TWITTER_API_SECRET: 'axqKKnIwoBas7vIcxDzvAk5oIFM131DgaMKNddWLK6VzZwu5Zu',
    TWITTER_ACCESS_TOKEN: '1932548729891872768-d01PzWgj5WaYcpRCRPKaPgpFksRMyr',
    TWITTER_ACCESS_SECRET: '4qcoWnLtnSiAggPzFV9OXDaClkZeTbWLu7Ag5G04TY21f',
    POST_INTERVAL_MINUTES: 60,
    
    // Performance Filters - coins must meet ALL these criteria
    MIN_PUMP_5M: 10,           // Minimum 5m price change %
    MIN_PUMP_1H: 5,            // Minimum 1h price change %
    MIN_VOLUME_24H: 50000,     // Minimum $50K 24h volume
    MIN_LIQUIDITY: 20000,      // Minimum $20K liquidity
    MIN_TXNS_24H: 100,         // Minimum 100 transactions
    MIN_AGE_MINUTES: 30,       // At least 30 min old (avoid honeypots)
    MAX_AGE_HOURS: 72,         // Not older than 3 days (still fresh)
    MIN_SAFETY: 55,            // Minimum safety score
    
    COOLDOWN_MINUTES: 120,     // Don't repost same coin for 2 hours
};

const DEX_API = 'https://api.dexscreener.com';

// Trending crypto hashtags - rotates for variety
const HASHTAG_SETS = [
    '#Solana #SOL #Memecoin #Crypto #100x',
    '#SOL #Solana #CryptoGems #Memecoin #DeFi',
    '#Solana #Altcoins #CryptoTwitter #SOL #Gems',
    '#SOL #Memecoin #SolanaNFT #Crypto #Web3',
    '#Solana #CryptoAlpha #SOL #Memecoins #Degen',
    '#SOL #Solana #CryptoCommunity #Altcoin #Pump',
    '#Memecoin #Solana #SOL #CryptoNews #100xGem',
    '#Solana #SOL #DegenSZN #Memecoin #CryptoGains',
];

function getHashtags() {
    return HASHTAG_SETS[Math.floor(Math.random() * HASHTAG_SETS.length)];
}

/**
 * FETCH BY PERFORMANCE - Not by name!
 * Uses DEX Screener's token boosts and gainers endpoints
 */
async function fetchTopPerformingCoins() {
    const coins = new Map();
    
    console.log('📊 Fetching by PERFORMANCE metrics...');
    
    try {
        // Method 1: Get Solana boosted/trending tokens
        const boostsData = await httpGet(`${DEX_API}/token-boosts/top/v1`);
        if (boostsData && Array.isArray(boostsData)) {
            for (const token of boostsData) {
                if (token.chainId === 'solana' && token.tokenAddress) {
                    await fetchTokenDetails(token.tokenAddress, coins);
                }
            }
        }
        console.log(`  ✓ Boosted tokens: found ${coins.size} so far`);
    } catch (e) {
        console.log(`  ✗ Boosts endpoint: ${e.message}`);
    }
    
    await sleep(300);
    
    try {
        // Method 2: Get latest Solana tokens with activity
        const latestData = await httpGet(`${DEX_API}/token-profiles/latest/v1`);
        if (latestData && Array.isArray(latestData)) {
            for (const token of latestData.slice(0, 30)) {
                if (token.chainId === 'solana' && token.tokenAddress) {
                    await fetchTokenDetails(token.tokenAddress, coins);
                }
            }
        }
        console.log(`  ✓ Latest tokens: now have ${coins.size} total`);
    } catch (e) {
        console.log(`  ✗ Latest endpoint: ${e.message}`);
    }
    
    await sleep(300);
    
    try {
        // Method 3: Search for active Solana pairs sorted by volume
        const pairsData = await httpGet(`${DEX_API}/latest/dex/pairs/solana`);
        if (pairsData && pairsData.pairs) {
            for (const pair of pairsData.pairs) {
                const coin = processToken(pair);
                if (coin && !coins.has(coin.address)) {
                    coins.set(coin.address, coin);
                }
            }
        }
        console.log(`  ✓ Solana pairs: now have ${coins.size} total`);
    } catch (e) {
        console.log(`  ✗ Pairs endpoint: ${e.message}`);
    }
    
    await sleep(300);
    
    try {
        // Method 4: Get pairs from Raydium (main Solana DEX)
        const raydiumData = await httpGet(`${DEX_API}/latest/dex/pairs/raydium`);
        if (raydiumData && raydiumData.pairs) {
            for (const pair of raydiumData.pairs) {
                if (pair.chainId === 'solana') {
                    const coin = processToken(pair);
                    if (coin && !coins.has(coin.address)) {
                        coins.set(coin.address, coin);
                    }
                }
            }
        }
        console.log(`  ✓ Raydium pairs: now have ${coins.size} total`);
    } catch (e) {
        console.log(`  ✗ Raydium endpoint: ${e.message}`);
    }
    
    return Array.from(coins.values());
}

async function fetchTokenDetails(address, coins) {
    if (coins.has(address)) return;
    
    try {
        const data = await httpGet(`${DEX_API}/latest/dex/tokens/${address}`);
        if (data && data.pairs && data.pairs.length > 0) {
            // Get the pair with highest liquidity
            const bestPair = data.pairs
                .filter(p => p.chainId === 'solana')
                .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
            
            if (bestPair) {
                const coin = processToken(bestPair);
                if (coin) coins.set(coin.address, coin);
            }
        }
        await sleep(100); // Rate limit protection
    } catch (e) {
        // Skip failed tokens silently
    }
}

function processToken(pair) {
    try {
        const now = Date.now();
        const created = pair.pairCreatedAt || now;
        const ageMinutes = (now - created) / (1000 * 60);
        const ageHours = ageMinutes / 60;
        
        const change5m = pair.priceChange?.m5 || 0;
        const change1h = pair.priceChange?.h1 || 0;
        const change24h = pair.priceChange?.h24 || 0;
        const volume = pair.volume?.h24 || 0;
        const liquidity = pair.liquidity?.usd || 0;
        const txns = (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0);
        const buys = pair.txns?.h24?.buys || 0;
        const sells = pair.txns?.h24?.sells || 0;
        const marketCap = pair.marketCap || pair.fdv || 0;
        
        // Calculate safety score based on metrics
        let safety = 50;
        
        // Liquidity score
        if (liquidity > 100000) safety += 20;
        else if (liquidity > 50000) safety += 15;
        else if (liquidity > 20000) safety += 10;
        else if (liquidity < 10000) safety -= 15;
        
        // Volume health
        const volLiqRatio = liquidity > 0 ? volume / liquidity : 0;
        if (volLiqRatio > 0.5 && volLiqRatio < 5) safety += 10;
        else if (volLiqRatio > 10) safety -= 10; // Suspicious
        
        // Transaction count
        if (txns > 1000) safety += 15;
        else if (txns > 500) safety += 10;
        else if (txns > 100) safety += 5;
        else if (txns < 50) safety -= 10;
        
        // Buy/sell ratio
        const buySellRatio = sells > 0 ? buys / sells : 1;
        if (buySellRatio > 0.7 && buySellRatio < 2) safety += 5;
        else if (buySellRatio < 0.3) safety -= 15; // Heavy selling
        else if (buySellRatio > 5) safety -= 5; // Suspicious
        
        // Age factor
        if (ageMinutes < 30) safety -= 15; // Too new, risky
        else if (ageHours > 24) safety += 5; // Survived a day
        
        safety = Math.max(0, Math.min(100, safety));
        
        return { 
            address: pair.baseToken.address, 
            name: pair.baseToken.name || '?', 
            symbol: pair.baseToken.symbol || '?', 
            change5m, change1h, change24h,
            volume, liquidity, marketCap,
            safety, txns, buys, sells,
            ageMinutes, ageHours,
            buySellRatio
        };
    } catch (e) {
        return null;
    }
}

/**
 * Filter coins by PERFORMANCE CRITERIA
 */
function filterByPerformance(coins) {
    return coins.filter(c => {
        // Must be pumping
        if (c.change5m < CONFIG.MIN_PUMP_5M) return false;
        if (c.change1h < CONFIG.MIN_PUMP_1H) return false;
        
        // Must have real volume and liquidity
        if (c.volume < CONFIG.MIN_VOLUME_24H) return false;
        if (c.liquidity < CONFIG.MIN_LIQUIDITY) return false;
        
        // Must have active trading
        if (c.txns < CONFIG.MIN_TXNS_24H) return false;
        
        // Age check - not too new, not too old
        if (c.ageMinutes < CONFIG.MIN_AGE_MINUTES) return false;
        if (c.ageHours > CONFIG.MAX_AGE_HOURS) return false;
        
        // Safety check
        if (c.safety < CONFIG.MIN_SAFETY) return false;
        
        // Not already posted recently
        if (!canPost(c)) return false;
        
        return true;
    });
}

/**
 * Rank coins by quality score
 */
function rankByQuality(coins) {
    return coins.sort((a, b) => {
        // Score = pump strength + safety + volume factor
        const scoreA = (a.change5m * 1.5) + (a.change1h * 0.5) + a.safety + Math.log10(a.volume) * 5;
        const scoreB = (b.change5m * 1.5) + (b.change1h * 0.5) + b.safety + Math.log10(b.volume) * 5;
        return scoreB - scoreA;
    });
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
    const tags = getHashtags();
    
    // Determine momentum description
    let momentum = '';
    if (coin.change5m > 50) momentum = 'EXPLODING 💥';
    else if (coin.change5m > 30) momentum = 'MOONING 🌙';
    else if (coin.change5m > 20) momentum = 'PUMPING HARD 🔥';
    else momentum = 'ON THE MOVE 📈';
    
    // Determine verdict
    let verdict = '';
    if (coin.safety >= 70 && coin.change5m > 20) verdict = '🟢 HIGH CONVICTION';
    else if (coin.safety >= 60) verdict = '🟡 SOLID METRICS';
    else verdict = '⚡ DEGEN PLAY';
    
    // Age description
    let ageDesc = '';
    if (coin.ageMinutes < 60) ageDesc = `${Math.round(coin.ageMinutes)}m old`;
    else if (coin.ageHours < 24) ageDesc = `${Math.round(coin.ageHours)}h old`;
    else ageDesc = `${Math.round(coin.ageHours / 24)}d old`;
    
    const templates = [
        // Template 1 - Performance Focused
`${momentum}

$${coin.symbol} +${coin.change5m.toFixed(1)}% (5m)

📊 Performance:
• 1h: ${coin.change1h >= 0 ? '+' : ''}${coin.change1h.toFixed(1)}%
• Vol: ${formatVol(coin.volume)}
• Liq: ${formatVol(coin.liquidity)}
• ${coin.txns.toLocaleString()} trades

${verdict} | Safety: ${coin.safety}/100

🔗 ${coinUrl}

${tags}`,

        // Template 2 - Alert Style
`🚨 $${coin.symbol} PUMP DETECTED

+${coin.change5m.toFixed(1)}% in 5 min
+${coin.change1h.toFixed(1)}% in 1 hour

💰 ${formatVol(coin.volume)} 24h volume
💧 ${formatVol(coin.liquidity)} liquidity
📈 ${coin.txns.toLocaleString()} transactions

${coin.buys > coin.sells ? '🟢 Buyers > Sellers' : '📊 Active market'}

${coinUrl}

${tags}`,

        // Template 3 - Data Analysis
`📡 RADAR: $${coin.symbol}

Performance Metrics:
├ 5m:  +${coin.change5m.toFixed(1)}%
├ 1h:  ${coin.change1h >= 0 ? '+' : ''}${coin.change1h.toFixed(1)}%
├ 24h: ${coin.change24h >= 0 ? '+' : ''}${coin.change24h.toFixed(0)}%
└ Age: ${ageDesc}

Volume: ${formatVol(coin.volume)}
Liquidity: ${formatVol(coin.liquidity)}
Safety: ${coin.safety}/100

${coinUrl}

${tags}`,

        // Template 4 - Quick Hit
`$${coin.symbol} 🚀

+${coin.change5m.toFixed(1)}% (5m) | +${coin.change1h.toFixed(1)}% (1h)

Vol: ${formatVol(coin.volume)}
Liq: ${formatVol(coin.liquidity)}
Trades: ${coin.txns.toLocaleString()}
Safety: ${coin.safety}/100

${verdict}

${coinUrl}

${tags}`,

        // Template 5 - Discovery
`Found one pumping 👀

$${coin.symbol} up +${coin.change5m.toFixed(1)}% in 5 min

📊 Metrics check:
• ${formatVol(coin.volume)} volume ✓
• ${formatVol(coin.liquidity)} liquidity ✓
• ${coin.txns} trades ✓
• ${coin.safety}/100 safety ✓

${ageDesc} | ${verdict}

${coinUrl}

${tags}`,

        // Template 6 - Alpha Style
`🔔 $${coin.symbol} Alpha

Pump: +${coin.change5m.toFixed(1)}% (5m)
Trend: +${coin.change1h.toFixed(1)}% (1h)
MCap: ${formatVol(coin.marketCap)}

Buy/Sell: ${coin.buySellRatio.toFixed(2)} ${coin.buySellRatio > 1 ? '🟢' : '🔴'}
Volume: ${formatVol(coin.volume)}
Safety: ${coin.safety}/100

${coinUrl}

${tags}`,

        // Template 7 - Metrics Heavy
`$${coin.symbol} Performance Report

⏱️ 5m: +${coin.change5m.toFixed(1)}%
⏱️ 1h: ${coin.change1h >= 0 ? '+' : ''}${coin.change1h.toFixed(1)}%
⏱️ 24h: ${coin.change24h >= 0 ? '+' : ''}${coin.change24h.toFixed(0)}%

💰 Vol: ${formatVol(coin.volume)}
💧 Liq: ${formatVol(coin.liquidity)}
📊 Txns: ${coin.txns.toLocaleString()}
🛡️ Safety: ${coin.safety}/100

${coinUrl}

${tags}`,

        // Template 8 - Conversational
`This one's moving 👀

$${coin.symbol} just pumped +${coin.change5m.toFixed(1)}%

Strong metrics:
- ${formatVol(coin.volume)} in volume
- ${formatVol(coin.liquidity)} liquidity
- ${coin.txns} trades today
- Safety score: ${coin.safety}/100

Worth a look:
${coinUrl}

${tags}`,
    ];
    
    return templates[Math.floor(Math.random() * templates.length)];
}

function httpGet(url) { 
    return new Promise((res, rej) => { 
        https.get(url, r => { 
            let d = ''; 
            r.on('data', c => d += c); 
            r.on('end', () => { 
                try { res(JSON.parse(d)); } 
                catch(e) { rej(e); } 
            }); 
        }).on('error', rej); 
    }); 
}

function formatVol(v) { 
    if (!v) return '$0'; 
    if (v >= 1e9) return `$${(v/1e9).toFixed(2)}B`; 
    if (v >= 1e6) return `$${(v/1e6).toFixed(2)}M`; 
    if (v >= 1e3) return `$${(v/1e3).toFixed(0)}K`; 
    return `$${v.toFixed(0)}`; 
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const posted = new Map();
function canPost(c) { const t = posted.get(c.address); return !t || Date.now() - t > CONFIG.COOLDOWN_MINUTES * 60000; }
function markPosted(c) { posted.set(c.address, Date.now()); }

async function run() {
    console.log('========================================');
    console.log('📡 SOLANA RADAR Twitter Bot');
    console.log('========================================');
    console.log(`Site: ${CONFIG.SITE_URL}`);
    console.log(`Posting: Once per hour`);
    console.log('');
    console.log('📊 PERFORMANCE FILTERS:');
    console.log(`   Min 5m pump: +${CONFIG.MIN_PUMP_5M}%`);
    console.log(`   Min 1h pump: +${CONFIG.MIN_PUMP_1H}%`);
    console.log(`   Min volume: ${formatVol(CONFIG.MIN_VOLUME_24H)}`);
    console.log(`   Min liquidity: ${formatVol(CONFIG.MIN_LIQUIDITY)}`);
    console.log(`   Min transactions: ${CONFIG.MIN_TXNS_24H}`);
    console.log(`   Min safety: ${CONFIG.MIN_SAFETY}`);
    console.log(`   Age: ${CONFIG.MIN_AGE_MINUTES}m - ${CONFIG.MAX_AGE_HOURS}h`);
    console.log('========================================\n');
    
    async function tick() {
        console.log(`\n[${new Date().toLocaleTimeString()}] 🔍 Scanning by PERFORMANCE...\n`);
        
        try {
            // Fetch coins by performance metrics
            const allCoins = await fetchTopPerformingCoins();
            console.log(`\n📈 Total coins fetched: ${allCoins.length}`);
            
            // Filter by our performance criteria
            const filtered = filterByPerformance(allCoins);
            console.log(`✅ Passed all filters: ${filtered.length}`);
            
            // Rank by quality
            const ranked = rankByQuality(filtered);
            
            if (ranked.length > 0) {
                const coin = ranked[0];
                console.log(`\n🎯 BEST PERFORMER: $${coin.symbol}`);
                console.log(`   5m: +${coin.change5m.toFixed(1)}%`);
                console.log(`   1h: +${coin.change1h.toFixed(1)}%`);
                console.log(`   Vol: ${formatVol(coin.volume)}`);
                console.log(`   Liq: ${formatVol(coin.liquidity)}`);
                console.log(`   Txns: ${coin.txns}`);
                console.log(`   Safety: ${coin.safety}/100`);
                console.log(`   Age: ${coin.ageMinutes < 60 ? Math.round(coin.ageMinutes) + 'm' : Math.round(coin.ageHours) + 'h'}`);
                
                const tweet = generateTweet(coin);
                console.log(`\n📝 Tweet:\n${tweet}\n`);
                
                const result = await postTweet(tweet);
                console.log(`✅ POSTED! Tweet ID: ${result.data?.id}`);
                console.log(`🔗 ${CONFIG.SITE_URL}?coin=${coin.address}\n`);
                markPosted(coin);
            } else {
                console.log('\n❌ No coins passed all performance filters\n');
                
                // Show what we found for debugging
                if (allCoins.length > 0) {
                    const best = allCoins.sort((a,b) => b.change5m - a.change5m)[0];
                    console.log(`   Best 5m pump found: $${best.symbol} +${best.change5m.toFixed(1)}%`);
                    console.log(`   But failed on: ${best.volume < CONFIG.MIN_VOLUME_24H ? 'volume' : best.liquidity < CONFIG.MIN_LIQUIDITY ? 'liquidity' : best.safety < CONFIG.MIN_SAFETY ? 'safety' : best.txns < CONFIG.MIN_TXNS_24H ? 'txns' : 'other'}`);
                }
            }
        } catch (e) { 
            console.error(`❌ Error: ${e.message}\n`); 
        }
    }
    
    // Run immediately
    await tick();
    
    // Then once per hour
    setInterval(tick, CONFIG.POST_INTERVAL_MINUTES * 60000);
    console.log(`⏰ Next scan in 1 hour...\n`);
}

run();
