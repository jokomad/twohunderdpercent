const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');

const SENT_FILE = path.join(__dirname, 'sent_symbols.json');
const PORT = process.env.PORT || 8000;

// Telegram Configuration
const TELEGRAM_BOT_TOKEN = '8531770574:AAFaigDKYYIE_QGbr_LIGwWzT-jpEJ1STBc';
const TELEGRAM_CHAT_ID = '-1003583931439';

// Function to send Telegram message
function sendTelegramMessage(message) {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || TELEGRAM_BOT_TOKEN === 'YOUR_BOT_TOKEN') {
        return;
    }
    const postData = JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'HTML'
    });
    const options = {
        hostname: 'api.telegram.org',
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };
    const req = https.request(options, (res) => {
        if (res.statusCode !== 200) {
            console.error(`Telegram API Error: ${res.statusCode}`);
        }
    });
    req.on('error', (error) => {
        console.error('Error sending Telegram message:', error.message);
    });
    req.write(postData);
    req.end();
}

// Function to get current date string in CET (YYYY-MM-DD)
function getCETDateString() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
}

// Function to load sent symbols for the current day
function loadSentData() {
    const today = getCETDateString();
    try {
        if (fs.existsSync(SENT_FILE)) {
            const data = JSON.parse(fs.readFileSync(SENT_FILE, 'utf8'));
            if (data.date === today) {
                return data;
            }
            console.log(`New day detected (${today}). Resetting sent symbols...`);
        }
    } catch (error) {
        console.error('Error loading sent data:', error.message);
    }
    // Return fresh state for new day or if file missing/invalid
    const newState = { date: today, symbols: [] };
    saveSentData(newState);
    return newState;
}

// Function to save sent symbols
function saveSentData(data) {
    try {
        fs.writeFileSync(SENT_FILE, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving sent data:', error.message);
    }
}

// Function to check for symbols with price change > 200%
async function checkPriceChangeAlerts() {
    let tickerData = null;
    try {
        console.log('Fetching 24h ticker data for price change alerts...');
        tickerData = await fetch24hTickerData();
        const sentData = loadSentData();

        const alertPairs = tickerData.filter(ticker => {
            const priceChange = parseFloat(ticker.priceChangePercent || 0);
            // Only alert if > 200% (positive only) AND not already sent today
            return priceChange > 200 && !sentData.symbols.includes(ticker.symbol);
        });

        if (alertPairs.length > 0) {
            let telegramMessage = "🚀 <b>Price Change Alert (>200%)</b>\n\n";
            alertPairs.forEach(p => {
                const direction = parseFloat(p.priceChangePercent) > 0 ? "🟢" : "🔴";
                telegramMessage += `${direction} ${p.symbol}: ${parseFloat(p.priceChangePercent).toFixed(2)}%\n`;
                sentData.symbols.push(p.symbol);
            });

            // Save updated sent symbols
            saveSentData(sentData);

            sendTelegramMessage(telegramMessage);
            console.log(`⚠️ SENT TELEGRAM ALERT FOR ${alertPairs.length} NEW SYMBOLS (>200% CHG)`);
        } else {
            console.log('No new symbols found with >200% price change today.');
        }
    } catch (error) {
        console.error('Error checking price change alerts:', error.message);
    } finally {
        // Clear large ticker data explicitly to help GC
        tickerData = null;
    }
}

// Function to fetch 24h ticker data for all symbols
async function fetch24hTickerData() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'fapi.binance.com',
            path: '/fapi/v1/ticker/24hr',
            method: 'GET',
            headers: {
                'User-Agent': 'Node.js'
            }
        };
        const req = https.request(options, (res) => {
            const chunks = [];
            res.on('data', (chunk) => {
                chunks.push(chunk);
            });
            res.on('end', () => {
                let tickerData = null;
                try {
                    if (res.statusCode !== 200) {
                        reject(new Error(`HTTP ${res.statusCode}`));
                        return;
                    }
                    const fullBuffer = Buffer.concat(chunks);
                    tickerData = JSON.parse(fullBuffer.toString());
                    // Clear references to chunks and buffer
                    chunks.length = 0;
                    resolve(tickerData);
                } catch (error) {
                    reject(error);
                }
            });
        });
        req.on('error', (error) => {
            reject(error);
        });
        req.end();
    });
}

// Function to run scan
async function runScan() {
    const runTime = new Date();
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 STARTING ALERT CHECK AT ${runTime.toLocaleTimeString()}`);
    console.log(`${'='.repeat(60)}`);

    await checkPriceChangeAlerts();

    const used = process.memoryUsage().heapUsed / 1024 / 1024;
    console.log(`Memory usage: ${Math.round(used * 100) / 100} MB`);
    console.log(`${'='.repeat(60)}\n`);
}
// Function to schedule scans every 10 seconds
function scheduleScans() {
    setInterval(() => {
        const now = new Date();
        const seconds = now.getSeconds();
        // Run every 10 seconds (at 0, 10, 20, 30, 40, 50)
        if (seconds % 10 === 0) {
            runScan();
        }
    }, 1000);
}

// Create HTTP server for health checks
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
});

// Start the server and scanner
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT} (Health Check)`);
    console.log('Starting 24h Price Change Alerter - runs every 10 seconds');
    scheduleScans();
});
