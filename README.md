# SOLANA RADAR Twitter Bot

Auto-tweets about pumping coins with direct links to solanaradar.space

## Setup

1. Get Twitter API keys from developer.twitter.com
2. Edit `bot.js` CONFIG section OR set environment variables
3. Run: `node bot.js`

## How it works

- Scans DEX Screener every 5 minutes
- Finds coins pumping >15% with good safety
- Posts tweet with direct link: `solanaradar.space?coin=ADDRESS`
- When users click, they see that coin highlighted on your site

## Example Tweet

```
🚀 $PEPE PUMPING +25.3%

💰 Vol: $150K
🛡️ Safety: 72/100

Track live:
https://solanaradar.space?coin=ABC123...

#Solana #Crypto
```

## Hosting

- Render.com (free)
- Railway.app (free)
- Any VPS with Node.js
