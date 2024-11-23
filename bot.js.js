const axios = require('axios');
const { Telegraf } = require('telegraf');
const cron = require('node-cron');

// Configuration
const TELEGRAM_BOT_TOKEN = '7669545778:AAHfUC6LZQxNB8FdxxSACsn-xenkFXwqIvQ';
const DEX_API_URL = 'https://api.dexscreener.com/latest/dex'; // Example DEX screener API URL

// Initialize Services
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

// Watchlist to keep track of tokens
let watchlist = [];
let pendingSells = []; // Track pending sells
let profitThreshold = 1.2; // Default 20% profit

// Helper Functions
async function getTokenInfo(tokenName) {
    try {
        const response = await axios.get(`${DEX_API_URL}/tokens/${tokenName}`);
        const data = response.data.pairs[0]; // Example: use first trading pair
        return {
            price: data.priceUsd,
            marketCap: data.marketCap,
            liquidity: data.liquidity.usd,
            volume: data.volume24h.usd,
        };
    } catch (error) {
        console.error('Error fetching token info:', error.message);
        return null;
    }
}

async function sellToken(tokenName, amount) {
    console.log(`Selling ${amount} units of ${tokenName}`);
    bot.telegram.sendMessage(`Sold ${amount} units of ${tokenName}. Transaction complete.`);
}

// Custom Sell Logic
async function shouldSell(token) {
    const tokenInfo = await getTokenInfo(token.name);

    if (!tokenInfo) {
        console.log(`No token info found for ${token.name}.`);
        return false;
    }

    const { price, marketCap, liquidity, volume } = tokenInfo;

    const boughtPrice = token.boughtPrice || price; // Use current price if boughtPrice is not set
    const profitPercentage = ((price - boughtPrice) / boughtPrice) * 100;

    // Profit Threshold: Ask if user wants to sell or keep tracking
    if (price >= boughtPrice * profitThreshold) {
        bot.telegram.sendMessage(
            `Your profit target for ${token.name} has been reached (+${profitPercentage.toFixed(2)}%).\n\n` +
            `Price: $${price}\nMarket Cap: $${marketCap}\nLiquidity: $${liquidity}\nVolume (24h): $${volume}\n\n` +
            `Reply with /keep ${token.name} to continue holding or /confirmSell ${token.name} <amount> to sell now.`
        );
        return false; // Wait for user confirmation
    }

    // Loss Threshold: Notify at 30% loss
    if (price <= boughtPrice * 0.7) {
        bot.telegram.sendMessage(
            `WARNING: ${token.name} has dropped by more than 30% (-${Math.abs(profitPercentage).toFixed(2)}%).\n\n` +
            `Price: $${price}\nMarket Cap: $${marketCap}\nLiquidity: $${liquidity}\nVolume (24h): $${volume}`
        );
        return false; // Notify but do not sell automatically
    }

    return false;
}

// Confirm Sell Command
bot.command('confirmSell', async (ctx) => {
    const [command, tokenName, amount] = ctx.message.text.split(' ');

    if (!tokenName || !amount || isNaN(amount)) {
        ctx.reply('Usage: /confirmSell <TokenName> <Amount>');
        return;
    }

    const sellRequest = pendingSells.find((req) => req.tokenName === tokenName);

    if (sellRequest) {
        pendingSells = pendingSells.filter((req) => req.tokenName !== tokenName);
        await sellToken(tokenName, parseFloat(amount));
        ctx.reply(`Confirmed! Sold ${amount} units of ${tokenName}.`);
    } else {
        ctx.reply(`No pending sell request found for ${tokenName}.`);
    }
});

// Keep Holding Command
bot.command('keep', (ctx) => {
    const [command, tokenName] = ctx.message.text.split(' ');

    if (!tokenName) {
        ctx.reply('Usage: /keep <TokenName>');
        return;
    }

    ctx.reply(`${tokenName} will remain in your portfolio. We'll keep tracking it.`);
    // No changes to sell logic; token remains in watchlist
});

// Adjust Profit Threshold Command
bot.command('setProfit', (ctx) => {
    const [command, newThreshold] = ctx.message.text.split(' ');

    if (!newThreshold || isNaN(newThreshold)) {
        ctx.reply('Usage: /setProfit <ProfitMultiplier>\nExample: /setProfit 1.5 for 50% profit.');
        return;
    }

    profitThreshold = parseFloat(newThreshold);
    ctx.reply(`Profit threshold set to ${((profitThreshold - 1) * 100).toFixed(2)}%.`);
});

// Add Token to Watchlist
bot.command('add', (ctx) => {
    const [command, tokenName, twitterQuery] = ctx.message.text.split(' ');
    if (tokenName && twitterQuery) {
        watchlist.push({ name: tokenName, twitterQuery, safetyCheck: true });
        ctx.reply(`${tokenName} added to the watchlist.`);
    } else {
        ctx.reply('Usage: /add <TokenName> <TwitterQuery>');
    }
});

// List Watchlist
bot.command('list', (ctx) => {
    if (watchlist.length === 0) {
        ctx.reply('The watchlist is empty.');
    } else {
        const tokens = watchlist.map((token) => token.name).join(', ');
        ctx.reply(`Currently watching: ${tokens}`);
    }
});

// Remove Token from Watchlist
bot.command('remove', (ctx) => {
    const [command, tokenName] = ctx.message.text.split(' ');
    watchlist = watchlist.filter((token) => token.name !== tokenName);
    ctx.reply(`${tokenName} removed from the watchlist.`);
});

// Automated Buy/Sell Check
cron.schedule('*/10 * * * *', async () => {
    console.log('Running automated checks...');
    for (const token of watchlist) {
        const sell = await shouldSell(token);
        if (sell) {
            console.log(`Sell conditions met for ${token.name}.`);
            pendingSells.push({ tokenName: token.name, amount: 100, notified: true });
        }
    }
});

// Telegram Bot Logic
bot.on('text', (ctx) => {
    ctx.reply('Command not recognized. Use /add, /list, /remove, /setProfit, /keep, or /confirmSell.');
});

// Run Telegram Bot
bot.launch();
console.log('Telegram bot started. Listening for Toxi notifications...');
