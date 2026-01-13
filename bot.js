/**
 * SOLANA RADAR Twitter Bot
 * Finds coins by PERFORMANCE DATA, not names
 * GUARANTEED post every hour - keeps scanning until it finds something
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
    RETRY_INTERVAL_SECONDS: 60,  // Retry every 60 seconds if no coin found
    MAX_RETRIES: 50,             // Max retries before giving up (50 min of trying)
    COOLDOWN_MINUTES: 120,
};

// Tiered filters - starts strict, loosens if nothing found
const FILTER_TIERS = [
    // Tier 1: Strict - Best quality
    {
        name: 'STRICT',
        MIN_PUMP_5M: 15,
        MIN_PUMP_1H: 10,
        MIN_VOLUME_24H: 100000,
        MIN_LIQUIDITY: 30000,
        MIN_TXNS_24H: 200,
        MIN_SAFETY: 60,
        MIN_AGE_MINUTES: 30,
        MAX_AGE_HOURS: 48,
    },
    // Tier 2: Normal
    {
        name: 'NORMAL',
        MIN_PUMP_5M: 10,
        MIN_PUMP_1H: 5,
        MIN_VOLUME_24H: 50000,
        MIN_LIQUIDITY: 20000,
        MIN_TXNS_24H: 100,
        MIN_SAFETY: 55,
        MIN_AGE_MINUTES: 20,
        MAX_AGE_HOURS: 72,
    },
    // Tier 3: Relaxed
    {
        name: 'RELAXED',
        MIN_PUMP_5M: 5,
        MIN_PUMP_1H: 0,
        MIN_VOLUME_24H: 25000,
        MIN_LIQUIDITY: 15000,
        MIN_TXNS_24H: 50,
        MIN_SAFETY: 50,
        MIN_AGE_MINUTES: 15,
        MAX_AGE_HOURS: 96,
    },
    // Tier 4: Minimum - Just need something postable
    {
        name: 'MINIMUM',
        MIN_PUMP_5M: 2,
        MIN_PUMP_1H: -5,
        MIN_VOLUME_24H: 10000,
        MIN_LIQUIDITY: 10000,
        MIN_TXNS_24H: 30,
        MIN_SAFETY: 45,
        MIN_AGE_MINUTES: 10,
        MAX_AGE_HOURS: 168,
    },
];

const DEX_API = 'https://api.dexscreener.com';

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

async function fetchTopPerformingCoins() {
    const coins = new Map();
    
    try {
        const boostsData = await httpGet(`${DEX_API}/token-boosts/top/v1`);
        if (boostsData && Array.isArray(boostsData)) {
            for (const token of boostsData) {
                if (token.chainId === 'solana' && token.tokenAddress) {
                    await fetchTokenDetails(token.tokenAddress, coins);
                }
            }
        }
    } catch (e) { /* skip */ }
    
    await sleep(300);
    
    try {
        const latestData = await httpGet(`${DEX_API}/token-profiles/latest/v1`);
        if (latestData && Array.isArray(latestData)) {
            for (const token of latestData.slice(0, 30)) {
                if (token.chainId === 'solana' && token.tokenAddress) {
                    await fetchTokenDetails(token.tokenAddress, coins);
                }
            }
        }
    } catch (e) { /* skip */ }
    
    await sleep(300);
    
    try {
        const pairsData = await httpGet(`${DEX_API}/latest/dex/pairs/solana`);
        if (pairsData && pairsData.pairs) {
            for (const pair of pairsData.pairs) {
                const coin = processToken(pair);
                if (coin && !coins.has(coin.address)) coins.set(coin.address, coin);
            }
        }
    } catch (e) { /* skip */ }
    
    await sleep(300);
    
    try {
        const raydiumData = await httpGet(`${DEX_API}/latest/dex/pairs/raydium`);
        if (raydiumData && raydiumData.pairs) {
            for (const pair of raydiumData.pairs) {
                if (pair.chainId === 'solana') {
                    const coin = processToken(pair);
                    if (coin && !coins.has(coin.address)) coins.set(coin.address, coin);
                }
            }
        }
    } catch (e) { /* skip */ }
    
    // Also try orca
    await sleep(300);
    try {
        const orcaData = await httpGet(`${DEX_API}/latest/dex/pairs/orca`);
        if (orcaData && orcaData.pairs) {
            for (const pair of orcaData.pairs) {
                if (pair.chainId === 'solana') {
                    const coin = processToken(pair);
                    if (coin && !coins.has(coin.address)) coins.set(coin.address, coin);
                }
            }
        }
    } catch (e) { /* skip */ }
    
    return Array.from(coins.values());
}

async function fetchTokenDetails(address, coins) {
    if (coins.has(address)) return;
    try {
        const data = await httpGet(`${DEX_API}/latest/dex/tokens/${address}`);
        if (data && data.pairs && data.pairs.length > 0) {
            const bestPair = data.pairs
                .filter(p => p.chainId === 'solana')
                .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
            if (bestPair) {
                const coin = processToken(bestPair);
                if (coin) coins.set(coin.address, coin);
            }
        }
        await sleep(100);
    } catch (e) { /* skip */ }
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
        
        let safety = 50;
        if (liquidity > 100000) safety += 20;
        else if (liquidity > 50000) safety += 15;
        else if (liquidity > 20000) safety += 10;
        else if (liquidity < 10000) safety -= 15;
        
        const volLiqRatio = liquidity > 0 ? volume / liquidity : 0;
        if (volLiqRatio > 0.5 && volLiqRatio < 5) safety += 10;
        else if (volLiqRatio > 10) safety -= 10;
        
        if (txns > 1000) safety += 15;
        else if (txns > 500) safety += 10;
        else if (txns > 100) safety += 5;
        else if (txns < 50) safety -= 10;
        
        const buySellRatio = sells > 0 ? buys / sells : 1;
        if (buySellRatio > 0.7 && buySellRatio < 2) safety += 5;
        else if (buySellRatio < 0.3) safety -= 15;
        
        if (ageMinutes < 30) safety -= 10;
        else if (ageHours > 24) safety += 5;
        
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

function filterByPerformance(coins, filters) {
    return coins.filter(c => {
        if (c.change5m < filters.MIN_PUMP_5M) return false;
        if (c.change1h < filters.MIN_PUMP_1H) return false;
        if (c.volume < filters.MIN_VOLUME_24H) return false;
        if (c.liquidity < filters.MIN_LIQUIDITY) return false;
        if (c.txns < filters.MIN_TXNS_24H) return false;
        if (c.ageMinutes < filters.MIN_AGE_MINUTES) return false;
        if (c.ageHours > filters.MAX_AGE_HOURS) return false;
        if (c.safety < filters.MIN_SAFETY) return false;
        if (!canPost(c)) return false;
        return true;
    });
}

function rankByQuality(coins) {
    return coins.sort((a, b) => {
        const scoreA = (a.change5m * 1.5) + (a.change1h * 0.5) + a.safety + Math.log10(Math.max(a.volume, 1)) * 5;
        const scoreB = (b.change5m * 1.5) + (b.change1h * 0.5) + b.safety + Math.log10(Math.max(b.volume, 1)) * 5;
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

function generateTweet(coin, tierName) {
    const coinUrl = `${CONFIG.SITE_URL}?coin=${coin.address}`;
    const tags = getHashtags();
    
    let momentum = '';
    if (coin.change5m > 50) momentum = 'EXPLODING 💥';
    else if (coin.change5m > 30) momentum = 'MOONING 🌙';
    else if (coin.change5m > 20) momentum = 'PUMPING HARD 🔥';
    else if (coin.change5m > 10) momentum = 'HEATING UP 📈';
    else if (coin.change5m > 0) momentum = 'MOVING UP ⬆️';
    else momentum = 'ACTIVE 📊';
    
    let verdict = '';
    if (coin.safety >= 70 && coin.change5m > 15) verdict = '🟢 HIGH CONVICTION';
    else if (coin.safety >= 60 && coin.change5m > 5) verdict = '🟡 SOLID METRICS';
    else if (coin.safety >= 50) verdict = '⚡ WORTH WATCHING';
    else verdict = '👀 ON RADAR';
    
    let ageDesc = '';
    if (coin.ageMinutes < 60) ageDesc = `${Math.round(coin.ageMinutes)}m old`;
    else if (coin.ageHours < 24) ageDesc = `${Math.round(coin.ageHours)}h old`;
    else ageDesc = `${Math.round(coin.ageHours / 24)}d old`;
    
    const templates = [
`${momentum}

$${coin.symbol} ${coin.change5m >= 0 ? '+' : ''}${coin.change5m.toFixed(1)}% (5m)

📊 Stats:
• 1h: ${coin.change1h >= 0 ? '+' : ''}${coin.change1h.toFixed(1)}%
• Vol: ${formatVol(coin.volume)}
• Liq: ${formatVol(coin.liquidity)}
• Trades: ${coin.txns.toLocaleString()}

${verdict} | Safety: ${coin.safety}/100

🔗 ${coinUrl}

${tags}`,

`🚨 $${coin.symbol} ALERT

${coin.change5m >= 0 ? '+' : ''}${coin.change5m.toFixed(1)}% (5m) | ${coin.change1h >= 0 ? '+' : ''}${coin.change1h.toFixed(1)}% (1h)

💰 ${formatVol(coin.volume)} volume
💧 ${formatVol(coin.liquidity)} liquidity
📈 ${coin.txns.toLocaleString()} trades

${coin.buys > coin.sells ? '🟢 Buyers > Sellers' : '📊 Active market'}

${coinUrl}

${tags}`,

`📡 RADAR: $${coin.symbol}

Performance:
├ 5m:  ${coin.change5m >= 0 ? '+' : ''}${coin.change5m.toFixed(1)}%
├ 1h:  ${coin.change1h >= 0 ? '+' : ''}${coin.change1h.toFixed(1)}%
└ 24h: ${coin.change24h >= 0 ? '+' : ''}${coin.change24h.toFixed(0)}%

Vol: ${formatVol(coin.volume)}
Liq: ${formatVol(coin.liquidity)}
Safety: ${coin.safety}/100

${coinUrl}

${tags}`,

`$${coin.symbol} ${momentum}

${coin.change5m >= 0 ? '+' : ''}${coin.change5m.toFixed(1)}% (5m)
${coin.change1h >= 0 ? '+' : ''}${coin.change1h.toFixed(1)}% (1h)

Vol: ${formatVol(coin.volume)}
Liq: ${formatVol(coin.liquidity)}
Safety: ${coin.safety}/100

${verdict}

${coinUrl}

${tags}`,

`Spotted: $${coin.symbol} 👀

${coin.change5m >= 0 ? '+' : ''}${coin.change5m.toFixed(1)}% in 5 min

📊 Metrics:
• ${formatVol(coin.volume)} volume
• ${formatVol(coin.liquidity)} liquidity  
• ${coin.txns} trades
• ${coin.safety}/100 safety

${ageDesc} | ${verdict}

${coinUrl}

${tags}`,

`🔔 $${coin.symbol}

Move: ${coin.change5m >= 0 ? '+' : ''}${coin.change5m.toFixed(1)}% (5m)
Trend: ${coin.change1h >= 0 ? '+' : ''}${coin.change1h.toFixed(1)}% (1h)
MCap: ${formatVol(coin.marketCap)}

Buy/Sell: ${coin.buySellRatio.toFixed(2)} ${coin.buySellRatio > 1 ? '🟢' : '⚪'}
Vol: ${formatVol(coin.volume)}
Safety: ${coin.safety}/100

${coinUrl}

${tags}`,

`$${coin.symbol} Update

⏱️ 5m: ${coin.change5m >= 0 ? '+' : ''}${coin.change5m.toFixed(1)}%
⏱️ 1h: ${coin.change1h >= 0 ? '+' : ''}${coin.change1h.toFixed(1)}%
⏱️ 24h: ${coin.change24h >= 0 ? '+' : ''}${coin.change24h.toFixed(0)}%

💰 Vol: ${formatVol(coin.volume)}
💧 Liq: ${formatVol(coin.liquidity)}
🛡️ Safety: ${coin.safety}/100

${coinUrl}

${tags}`,

`${momentum}

$${coin.symbol} ${coin.change5m >= 0 ? '+' : ''}${coin.change5m.toFixed(1)}%

${formatVol(coin.volume)} in volume
${formatVol(coin.liquidity)} liquidity
${coin.txns} trades today
Safety: ${coin.safety}/100

Check it:
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

/**
 * GUARANTEED POST - keeps trying until successful
 */
async function findAndPost() {
    let retries = 0;
    let posted = false;
    
    while (!posted && retries < CONFIG.MAX_RETRIES) {
        console.log(`\n[${new Date().toLocaleTimeString()}] 🔍 Scan attempt ${retries + 1}/${CONFIG.MAX_RETRIES}\n`);
        
        try {
            const allCoins = await fetchTopPerformingCoins();
            console.log(`📈 Fetched ${allCoins.length} coins`);
            
            // Try each filter tier from strict to relaxed
            for (let tierIndex = 0; tierIndex < FILTER_TIERS.length; tierIndex++) {
                const tier = FILTER_TIERS[tierIndex];
                const filtered = filterByPerformance(allCoins, tier);
                
                console.log(`   Tier ${tierIndex + 1} (${tier.name}): ${filtered.length} coins pass`);
                
                if (filtered.length > 0) {
                    const ranked = rankByQuality(filtered);
                    const coin = ranked[0];
                    
                    console.log(`\n🎯 SELECTED ($${tier.name}): $${coin.symbol}`);
                    console.log(`   5m: ${coin.change5m >= 0 ? '+' : ''}${coin.change5m.toFixed(1)}%`);
                    console.log(`   1h: ${coin.change1h >= 0 ? '+' : ''}${coin.change1h.toFixed(1)}%`);
                    console.log(`   Vol: ${formatVol(coin.volume)}`);
                    console.log(`   Liq: ${formatVol(coin.liquidity)}`);
                    console.log(`   Safety: ${coin.safety}/100`);
                    
                    const tweet = generateTweet(coin, tier.name);
                    console.log(`\n📝 Tweet:\n${tweet}\n`);
                    
                    try {
                        const result = await postTweet(tweet);
                        console.log(`✅ POSTED! Tweet ID: ${result.data?.id}`);
                        console.log(`🔗 ${CONFIG.SITE_URL}?coin=${coin.address}\n`);
                        markPosted(coin);
                        posted = true;
                        break;
                    } catch (tweetError) {
                        console.error(`❌ Tweet failed: ${tweetError.message}`);
                        // Continue to try next coin or retry
                    }
                }
            }
            
            if (!posted) {
                console.log(`\n⏳ No suitable coin found, retrying in ${CONFIG.RETRY_INTERVAL_SECONDS}s...`);
                retries++;
                await sleep(CONFIG.RETRY_INTERVAL_SECONDS * 1000);
            }
            
        } catch (e) {
            console.error(`❌ Scan error: ${e.message}`);
            retries++;
            await sleep(CONFIG.RETRY_INTERVAL_SECONDS * 1000);
        }
    }
    
    if (!posted) {
        console.log(`\n⚠️ Could not find any coin to post after ${retries} attempts`);
    }
    
    return posted;
}

async function run() {
    console.log('========================================');
    console.log('📡 SOLANA RADAR Twitter Bot');
    console.log('========================================');
    console.log(`Site: ${CONFIG.SITE_URL}`);
    console.log(`Mode: GUARANTEED hourly post`);
    console.log(`Retries: Up to ${CONFIG.MAX_RETRIES} scans per hour`);
    console.log('');
    console.log('📊 FILTER TIERS (tries strict → relaxed):');
    FILTER_TIERS.forEach((t, i) => {
        console.log(`   ${i+1}. ${t.name}: ${t.MIN_PUMP_5M}%+ (5m), ${formatVol(t.MIN_VOLUME_24H)}+ vol`);
    });
    console.log('========================================\n');
    
    // Post immediately on start
    await findAndPost();
    
    // Then post every hour
    setInterval(async () => {
        console.log('\n⏰ HOURLY POST TIME\n');
        await findAndPost();
    }, CONFIG.POST_INTERVAL_MINUTES * 60000);
    
    console.log(`\n⏰ Next post in 1 hour...\n`);
}

run();
